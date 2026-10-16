//! The `sprisk` command. `serve` hosts the API; every other command is an HTTP client
//! of that API, the same path the UI and agents use (rule 4).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, bail};
use serde_json::{Value, json};
use sprisk_contracts::{
    Attempt, AttemptOutput, PipelineVersion, Problem, Run, RunId, RunStatus, parse,
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
}

impl ServeConfig {
    /// Layout of a source checkout: `plugins/`, `methodology/` and the uv `.venv`.
    pub fn for_repo(root: &Path, data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_owned(),
            plugins: root.join("plugins"),
            methodology: root.join("methodology"),
            python: root.join(".venv/bin/python"),
        }
    }
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
        // 409: this exact version was submitted before; versions are immutable, so reuse it.
        if response.status() != reqwest::StatusCode::CONFLICT {
            read::<PipelineVersion>(response).await?;
        }
        let response = self
            .http
            .post(format!("{}/runs", self.base))
            .json(&json!({"pipeline_version_id": pipeline.id}))
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
