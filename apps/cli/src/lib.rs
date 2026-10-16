//! The `sprisk` command. `serve` hosts the API; every other command is an HTTP client
//! of that API, the same path the UI and agents use (rule 4).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, bail};
use serde_json::{Value, json};
use sprisk_contracts::{
    Attempt, AttemptOutput, CreateRun, PipelineVersion, Problem, Run, RunId, RunStatus, parse,
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

/// Where `serve` keeps data and finds operators.
pub struct ServeConfig {
    pub data_dir: PathBuf,
    pub plugins: PathBuf,
    pub methodology: PathBuf,
    pub python: PathBuf,
    /// Directories pipelines may read local files from.
    pub data_roots: Vec<PathBuf>,
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
    let gate = sprisk_registry::Registry::load_dir(&config.methodology)?
        .get("sprisk.methodology.supervised@1.0.0")
        .context("methodology root has no Supervised pack entrypoint")?
        .clone();
    let state = sprisk_api::AppState {
        store: Arc::new(sprisk_store::SqliteStore::open(&config.data_dir.join("sprisk.db")).await?),
        artifacts: Arc::new(sprisk_artifacts::ArtifactStore::local(
            &config.data_dir.join("artifacts"),
        )?),
        registry: Arc::new(sprisk_registry::Registry::load_dir(&config.plugins)?),
        gate: Some(gate),
        worker_command: vec![
            config.python.display().to_string(),
            "-m".into(),
            "sprisk_workers".into(),
            "--plugins-root".into(),
            config.plugins.display().to_string(),
            "--plugins-root".into(),
            config.methodology.display().to_string(),
        ],
        settings: sprisk_scheduler::Settings::default(),
        data_roots: config
            .data_roots
            .iter()
            .map(|r| {
                r.canonicalize()
                    .with_context(|| format!("data root {}", r.display()))
            })
            .collect::<anyhow::Result<_>>()?,
    };
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

    /// Plain-text summary: one line per attempt, then every JSON output (metrics, checks).
    pub async fn report(&self, id: &RunId) -> anyhow::Result<String> {
        let run = self.run(id).await?;
        let attempts: Vec<Attempt> = read(
            self.http
                .get(format!("{}/runs/{}/attempts", self.base, id.as_str()))
                .send()
                .await?,
        )
        .await?;
        let mut out = format!("run {}  {}\n\n", id.as_str(), run.status);
        for a in &attempts {
            let error = a
                .error
                .as_ref()
                .map(|e| format!("  {}: {}", e.code.as_str(), e.message.as_str()))
                .unwrap_or_default();
            out += &format!(
                "{:<12} #{}  {}{error}\n",
                a.node_id.as_str(),
                a.number,
                a.state
            );
        }
        for a in attempts
            .iter()
            .filter(|a| a.state == sprisk_contracts::AttemptState::Succeeded)
        {
            let outputs: Vec<AttemptOutput> = read(
                self.http
                    .get(format!("{}/attempts/{}/outputs", self.base, a.id.as_str()))
                    .send()
                    .await?,
            )
            .await?;
            for o in outputs
                .iter()
                .filter(|o| o.artifact.media_type.as_str() == "application/json")
            {
                let text = self
                    .http
                    .get(format!(
                        "{}/artifacts/{}/content",
                        self.base,
                        o.artifact.id.as_str()
                    ))
                    .send()
                    .await?
                    .error_for_status()?
                    .text()
                    .await?;
                out += &format!("\n{}.{}:\n{text}\n", a.node_id.as_str(), o.port.as_str());
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
