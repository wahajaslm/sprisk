//! The `sprisk` command. `serve` hosts the API; every other command is an HTTP client
//! of that API, the same path the UI and agents use (rule 4).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, bail};
use serde_json::{Value, json};
use sprisk_contracts::{
    ArtifactId, Attempt, AttemptId, AttemptOutput, AttemptState, CreateRun, PipelineVersion,
    Problem, Run, RunId, RunStatus, parse,
};

/// Project used when a pipeline file names none. Local mode has one project.
pub const LOCAL_PROJECT: &str = "prj_00000000000000000000000000";

/// Read a pipeline file. `id`, `project_id`, `created_at` and `schema_version` may be omitted.
pub fn pipeline_from_yaml(text: &str, now: &str) -> anyhow::Result<PipelineVersion> {
    let mut value: Value = yaml_serde::from_str(text).context("pipeline file is not YAML")?;
    let Some(fields) = value.as_object_mut() else {
        bail!("pipeline file must be a mapping with nodes and edges");
    };
    let defaults = [
        ("schema_version", json!("sprisk.pipeline_version/v1")),
        ("id", json!(format!("plv_{}", ulid::Ulid::new()))),
        ("project_id", json!(LOCAL_PROJECT)),
        ("created_at", json!(now)),
    ];
    for (key, default) in defaults {
        fields.entry(key).or_insert(default);
    }
    parse(&value.to_string()).context("pipeline file is not a valid pipeline version")
}

/// The local Ollama the Copilot asks unless told otherwise (ADR-0066).
pub const DEFAULT_OLLAMA: &str = "http://127.0.0.1:11434";
/// The model the Copilot asks.
const COPILOT_MODEL: &str = "qwen2.5:7b";

/// Where `serve` keeps data and finds operators.
pub struct ServeConfig {
    pub data_dir: PathBuf,
    pub plugins: PathBuf,
    pub methodology: PathBuf,
    pub python: PathBuf,
    /// Directories pipelines may read local files from.
    pub data_roots: Vec<PathBuf>,
    /// The local Ollama the Copilot asks (ADR-0066). None: AI is off.
    pub ollama: Option<String>,
}

impl ServeConfig {
    /// Layout of a source checkout: `plugins/`, `methodology/` and the uv `.venv`.
    pub fn for_repo(root: &Path, data_dir: &Path, data_root: &Path) -> Self {
        Self {
            data_roots: vec![data_root.to_owned()],
            data_dir: data_dir.to_owned(),
            plugins: root.join("plugins"),
            methodology: root.join("methodology"),
            python: root.join(".venv/bin/python"),
            ollama: Some(DEFAULT_OLLAMA.into()),
        }
    }
}

/// The API has no authentication yet, so it may only listen on this machine.
pub fn loopback_addr(addr: &str) -> anyhow::Result<std::net::SocketAddr> {
    let parsed: std::net::SocketAddr = addr
        .parse()
        .with_context(|| format!("{addr} is not ip:port"))?;
    if !parsed.ip().is_loopback() {
        bail!(
            "refusing to listen on {addr}: the API has no authentication; use 127.0.0.1 or [::1]"
        );
    }
    Ok(parsed)
}

pub async fn serve_on(
    listener: tokio::net::TcpListener,
    config: ServeConfig,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(&config.data_dir)
        .with_context(|| format!("create {}", config.data_dir.display()))?;
    let methodology = sprisk_registry::Registry::load_dir(&config.methodology)?;
    let gate = methodology
        .get("sprisk.methodology.supervised@1.0.0")
        .context("methodology root has no Supervised pack entrypoint")?
        .clone();
    let split_check = methodology
        .get("sprisk.methodology.split_rows@1.0.0")
        .context("methodology root has no split row check entrypoint")?
        .clone();
    let plugins = sprisk_registry::Registry::load_dir(&config.plugins)?;
    let worker_command = vec![
        config.python.display().to_string(),
        "-m".into(),
        "sprisk_workers".into(),
        "--plugins-root".into(),
        config.plugins.display().to_string(),
        "--plugins-root".into(),
        config.methodology.display().to_string(),
    ];
    // Start one worker now, so the first run does not wait for Python to load (ADR-0026).
    let idle_worker = sprisk_scheduler::IdleWorker::default();
    let mut warm = sprisk_scheduler::ProcessWorkers {
        command: worker_command.clone(),
        idle: idle_worker.clone(),
    };
    tokio::spawn(async move {
        use sprisk_scheduler::Workers;
        match warm.spawn().await {
            Ok(worker) => warm.release(worker),
            Err(e) => eprintln!("could not start a worker ahead of the first run: {e}"),
        }
    });
    let data_roots: Vec<PathBuf> = config
        .data_roots
        .iter()
        .map(|r| {
            r.canonicalize()
                .with_context(|| format!("data root {}", r.display()))
        })
        .collect::<anyhow::Result<_>>()?;
    // A notebook's kernel runs where workers run, so a relative path in a cell reads the same
    // file in the session and in the node made from it (ADR-0036).
    let kernel_dir = std::env::current_dir().context("read the working directory")?;
    // A local 7B model on a laptop CPU can take a minute; Python gives up at 100 s.
    let copilot = config
        .ollama
        .as_deref()
        .map(|ollama| {
            sprisk_api::Copilot::local(
                vec![
                    config.python.display().to_string(),
                    "-m".into(),
                    "sprisk_workers.copilot".into(),
                ],
                ollama,
                COPILOT_MODEL,
                std::time::Duration::from_secs(120),
                2,
            )
        })
        .transpose()?;
    let kernels = sprisk_api::Kernels::new(
        vec![
            config.python.display().to_string(),
            "-m".into(),
            "sprisk_code.session".into(),
        ],
        kernel_dir,
        sprisk_api::KernelLimits {
            cell_seconds: 600,
            memory_mb: 4096,
            idle: std::time::Duration::from_secs(30 * 60),
            at_once: 4,
        },
    );
    let state = sprisk_api::AppState {
        clock: sprisk_scheduler::system_clock(),
        store: Arc::new(sprisk_store::SqliteStore::open(&config.data_dir.join("sprisk.db")).await?),
        artifacts: Arc::new(sprisk_artifacts::ArtifactStore::local(
            &config.data_dir.join("artifacts"),
        )?),
        rules: Arc::new(sprisk_methodology::RuleCatalog::load_dir(
            &config.methodology,
            plugins.operators(),
        )?),
        registry: Arc::new(plugins),
        gate: Some(gate),
        split_check: Some(split_check),
        worker_command,
        idle_worker,
        settings: sprisk_scheduler::Settings::default(),
        splitter: sprisk_api::Splitter::new(
            vec![
                config.python.display().to_string(),
                "-m".into(),
                "sprisk_code.cells".into(),
            ],
            std::time::Duration::from_secs(10),
            2,
        ),
        // A large table takes a while; the limit still stops a runaway (ADR-0038).
        profiler: sprisk_api::Profiler::new(
            vec![
                config.python.display().to_string(),
                "-m".into(),
                "sprisk_profile.dataset".into(),
            ],
            std::time::Duration::from_secs(60),
            2,
            sprisk_registry::source_digest(&config.plugins.join("profile/src"))?,
        ),
        // Reads only the first rows where the data lives (ADR-0067).
        source_profiler: sprisk_api::SourceProfiler::new(
            vec![
                config.python.display().to_string(),
                "-m".into(),
                "sprisk_profile.source".into(),
            ],
            std::time::Duration::from_secs(60),
            2,
        ),
        key_matcher: sprisk_api::KeyMatcher::new(
            vec![
                config.python.display().to_string(),
                "-m".into(),
                "sprisk_profile.keys".into(),
            ],
            std::time::Duration::from_secs(60),
            2,
        ),
        shifter: sprisk_api::Shifter::new(
            vec![
                config.python.display().to_string(),
                "-m".into(),
                "sprisk_profile.shift".into(),
            ],
            std::time::Duration::from_secs(60),
            2,
        ),
        code_writer: sprisk_api::CodeWriter::new(
            vec![
                config.python.display().to_string(),
                "-m".into(),
                "sprisk_workers.notebook_code".into(),
            ],
            std::time::Duration::from_secs(10),
            2,
        ),
        method_runner: sprisk_api::MethodRunner::new(
            vec![
                config.python.display().to_string(),
                "-m".into(),
                "sprisk_workers.method".into(),
            ],
            std::time::Duration::from_secs(30),
            4,
        ),
        data_roots,
        kernels: kernels.clone(),
        copilot,
    };
    tokio::spawn(async move {
        let mut every = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            every.tick().await;
            kernels.shut_idle().await;
        }
    });
    // Walks a stopped server left walking go on from their stored heads (ADR-0060).
    let resumed = sprisk_api::resume_walks(&state).await?;
    if resumed > 0 {
        eprintln!("resumed {resumed} walks");
    }
    axum::serve(listener, sprisk_api::router(state)).await?;
    Ok(())
}

pub struct Client {
    base: String,
    http: reqwest::Client,
}

impl Client {
    pub fn new(base: &str) -> Self {
        Self {
            base: base.trim_end_matches('/').to_owned(),
            http: reqwest::Client::new(),
        }
    }

    /// Store the pipeline version (Gate A) and start a run of it.
    pub async fn submit_and_start(&self, pipeline: &PipelineVersion) -> anyhow::Result<Run> {
        let response = self
            .http
            .post(format!("{}/pipeline_versions", self.base))
            .json(pipeline)
            .send()
            .await?;
        // 409: a version with this id exists. Versions are immutable, so reuse it only
        // when it is exactly what the user submitted.
        if response.status() == reqwest::StatusCode::CONFLICT {
            let stored: PipelineVersion = read(
                self.http
                    .get(format!(
                        "{}/pipeline_versions/{}",
                        self.base,
                        pipeline.id.as_str()
                    ))
                    .send()
                    .await?,
            )
            .await?;
            // `created_at` is filled at submit time, so it is not part of the content.
            let mut submitted = pipeline.clone();
            submitted.created_at = stored.created_at.clone();
            if stored != submitted {
                bail!(
                    "pipeline version {} already exists with different content; give it a new id",
                    pipeline.id.as_str()
                );
            }
        } else {
            read::<PipelineVersion>(response).await?;
        }
        let request = CreateRun {
            pipeline_version_id: pipeline.id.clone(),
            reuse_run_id: None,
            run_from_node_id: None,
        };
        let response = self
            .http
            .post(format!("{}/runs", self.base))
            .json(&request)
            .send()
            .await?;
        read(response).await
    }

    pub async fn run(&self, id: &RunId) -> anyhow::Result<Run> {
        read(
            self.http
                .get(format!("{}/runs/{}", self.base, id.as_str()))
                .send()
                .await?,
        )
        .await
    }

    /// Poll until the run finishes or `timeout` passes.
    pub async fn wait(&self, id: &RunId, timeout: Duration) -> anyhow::Result<Run> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let run = self.run(id).await?;
            if matches!(
                run.status,
                RunStatus::Succeeded | RunStatus::Failed | RunStatus::Cancelled
            ) {
                return Ok(run);
            }
            if tokio::time::Instant::now() >= deadline {
                bail!("run {} still {} after {timeout:?}", id.as_str(), run.status);
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    pub async fn attempts(&self, run: &RunId) -> anyhow::Result<Vec<Attempt>> {
        let url = format!("{}/runs/{}/attempts", self.base, run.as_str());
        read(self.http.get(url).send().await?).await
    }

    pub async fn outputs(&self, attempt: &AttemptId) -> anyhow::Result<Vec<AttemptOutput>> {
        let url = format!("{}/attempts/{}/outputs", self.base, attempt.as_str());
        read(self.http.get(url).send().await?).await
    }

    /// An artifact's bytes as text. For small JSON artifacts such as metrics and checks.
    pub async fn content(&self, artifact: &ArtifactId) -> anyhow::Result<String> {
        let url = format!("{}/artifacts/{}/content", self.base, artifact.as_str());
        Ok(self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?)
    }

    /// Plain-text summary: one line per attempt, then every JSON output (metrics, checks).
    pub async fn report(&self, id: &RunId) -> anyhow::Result<String> {
        let run = self.run(id).await?;
        let attempts = self.attempts(id).await?;
        let mut out = format!("run {}  {}\n\n", id.as_str(), run.status);
        for a in &attempts {
            let error = a
                .error
                .as_ref()
                .map(|e| format!("  {}: {}", e.code.as_str(), e.message.as_str()))
                .unwrap_or_default();
            out += &format!(
                "{:<15} #{}  {}{error}\n",
                a.node_id.as_str(),
                a.number,
                a.state
            );
        }
        for a in attempts
            .iter()
            .filter(|a| a.state == AttemptState::Succeeded)
        {
            for o in self.outputs(&a.id).await? {
                if o.artifact.media_type.as_str() == "application/json" {
                    let text = self.content(&o.artifact.id).await?;
                    out += &format!("\n{}.{}:\n{text}\n", a.node_id.as_str(), o.port.as_str());
                }
            }
        }
        Ok(out)
    }
}

/// Parse a success body through the contract, or turn a Problem body into an error.
async fn read<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> anyhow::Result<T> {
    let status = response.status();
    let text = response.text().await?;
    if status.is_success() {
        return parse(&text).with_context(|| format!("unexpected response body: {text}"));
    }
    match parse::<Problem>(&text) {
        Ok(problem) => {
            let lines: Vec<String> = problem
                .errors
                .iter()
                .map(|e| format!("  {}: {}", e.code.as_str(), e.message.as_str()))
                .collect();
            bail!("server returned {status}:\n{}", lines.join("\n"))
        }
        Err(_) => bail!("server returned {status}: {text}"),
    }
}
