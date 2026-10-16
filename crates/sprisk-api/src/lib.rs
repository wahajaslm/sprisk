//! HTTP API: the one path UI, CLI, SDK and agents use (rule 4). Handlers hold no state;
//! the database is the truth.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use sprisk_artifacts::ArtifactStore;
use sprisk_contracts::{
    ArtifactId, AttemptId, CreateRun, Operator, PipelineVersion, PipelineVersionId, Problem, Run,
    RunId, parse,
};
use sprisk_graph::{CompileError, compile};
use sprisk_registry::Registry;
use sprisk_scheduler::{ProcessWorkers, Scheduler, Settings};
use sprisk_store::{SqliteStore, StoreError};

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<SqliteStore>,
    pub artifacts: Arc<ArtifactStore>,
    pub registry: Arc<Registry>,
    /// Methodology pack entrypoint run as Gate B before each run (ADR-0017).
    pub gate: Option<Operator>,
    /// Command that starts one Python worker.
    pub worker_command: Vec<String>,
    pub settings: Settings,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/pipeline_versions", post(create_pipeline_version))
        .route("/pipeline_versions/{id}", get(get_pipeline_version))
        .route("/runs", post(create_run))
        .route("/runs/{id}", get(get_run))
        .route("/runs/{id}/attempts", get(list_attempts))
        .route("/attempts/{id}/outputs", get(list_outputs))
        .route("/artifacts/{id}", get(get_artifact))
        .route("/artifacts/{id}/content", get(get_artifact_content))
        .with_state(state)
}

#[derive(Debug, thiserror::Error)]
enum ApiError {
    #[error("{code}: {message}")]
    BadRequest { code: &'static str, message: String },
    #[error("invalid pipeline")]
    Compile(Vec<CompileError>),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Artifacts(#[from] sprisk_artifacts::StoreError),
    #[error("{0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, errors) = match &self {
            ApiError::BadRequest { code, message } => {
                let status = if *code == "invalid_id" {
                    StatusCode::BAD_REQUEST
                } else {
                    StatusCode::UNPROCESSABLE_ENTITY
                };
                (status, vec![(*code, message.clone())])
            }
            ApiError::Compile(errors) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                errors.iter().map(|e| (e.code(), e.to_string())).collect(),
            ),
            ApiError::Store(StoreError::NotFound { .. }) => {
                (StatusCode::NOT_FOUND, vec![("not_found", self.to_string())])
            }
            ApiError::Store(StoreError::Conflict(_)) => {
                (StatusCode::CONFLICT, vec![("conflict", self.to_string())])
            }
            _ => {
                tracing::error!(error = %self, "request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    vec![("internal", self.to_string())],
                )
            }
        };
        let body = json!({"errors": errors.iter().map(|(code, message)| json!({"code": code, "message": message})).collect::<Vec<_>>()});
        // Validate our own error shape through the contract before sending it.
        match parse::<Problem>(&body.to_string()) {
            Ok(problem) => (status, Json(problem)).into_response(),
            Err(e) => {
                tracing::error!(error = %e, "invalid problem body");
                let fallback = r#"{"errors":[{"code":"internal","message":"internal error"}]}"#;
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    fallback,
                )
                    .into_response()
            }
        }
    }
}

/// Parse a request body through the contract entry point, never raw serde.
fn body<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, ApiError> {
    parse(text).map_err(|e| ApiError::BadRequest {
        code: "invalid_body",
        message: e.to_string(),
    })
}

fn id<T: std::str::FromStr>(raw: &str) -> Result<T, ApiError> {
    raw.parse().map_err(|_| ApiError::BadRequest {
        code: "invalid_id",
        message: format!("{raw} is not a valid id"),
    })
}

async fn create_pipeline_version(
    State(state): State<AppState>,
    text: String,
) -> Result<(StatusCode, Json<PipelineVersion>), ApiError> {
    let pipeline: PipelineVersion = body(&text)?;
    compile(&pipeline, &state.registry).map_err(ApiError::Compile)?;
    state.store.insert_pipeline_version(&pipeline).await?;
    Ok((StatusCode::CREATED, Json(pipeline)))
}

async fn get_pipeline_version(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<PipelineVersion>, ApiError> {
    let pipeline_id: PipelineVersionId = id(&raw)?;
    Ok(Json(state.store.get_pipeline_version(&pipeline_id).await?))
}

async fn create_run(
    State(state): State<AppState>,
    text: String,
) -> Result<(StatusCode, Json<Run>), ApiError> {
    let request: CreateRun = body(&text)?;
    let pipeline = state
        .store
        .get_pipeline_version(&request.pipeline_version_id)
        .await?;
    let plan = compile(&pipeline, &state.registry).map_err(ApiError::Compile)?;
    let now = sprisk_core::time::now();
    let run: Run = parse(
        &json!({
            "schema_version": "sprisk.run/v1",
            "id": format!("run_{}", ulid::Ulid::new()),
            "project_id": pipeline.project_id,
            "pipeline_version_id": pipeline.id,
            "status": "queued",
            "created_at": now,
        })
        .to_string(),
    )
    .map_err(|e| ApiError::Internal(e.to_string()))?;
    state.store.insert_run(&run).await?;

    // Local mode runs in this process; the database stays the truth, so a restart
    // can resume the run (backlog: separate runner process).
    let run_id = run.id.clone();
    tokio::spawn(async move {
        let workers = ProcessWorkers {
            command: state.worker_command.clone(),
        };
        let mut scheduler = Scheduler::new(
            &state.store,
            &state.artifacts,
            workers,
            state.settings.clone(),
        );
        if let Some(gate) = state.gate.clone() {
            scheduler = scheduler.with_gate(gate);
        }
        if let Err(e) = scheduler.run(&run_id, &pipeline, &plan).await {
            tracing::error!(run = run_id.as_str(), error = %e, "run stopped");
        }
    });
    Ok((StatusCode::ACCEPTED, Json(run)))
}

async fn get_run(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<Run>, ApiError> {
    let run_id: RunId = id(&raw)?;
    Ok(Json(state.store.get_run(&run_id).await?))
}

async fn list_attempts(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<sprisk_contracts::Attempt>>, ApiError> {
    let run_id: RunId = id(&raw)?;
    state.store.get_run(&run_id).await?;
    Ok(Json(state.store.list_attempts(&run_id).await?))
}

async fn list_outputs(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<sprisk_contracts::AttemptOutput>>, ApiError> {
    let attempt: AttemptId = id(&raw)?;
    let outputs = state.store.outputs(&attempt).await?;
    let body = json!(
        outputs
            .into_iter()
            .map(|(port, artifact)| json!({"port": port, "artifact": artifact}))
            .collect::<Vec<_>>()
    );
    Ok(Json(
        parse(&body.to_string()).map_err(|e| ApiError::Internal(e.to_string()))?,
    ))
}

async fn get_artifact(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<sprisk_contracts::Artifact>, ApiError> {
    let artifact_id: ArtifactId = id(&raw)?;
    Ok(Json(state.store.get_artifact(&artifact_id).await?))
}

async fn get_artifact_content(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Response, ApiError> {
    let artifact_id: ArtifactId = id(&raw)?;
    let artifact = state.store.get_artifact(&artifact_id).await?;
    let bytes: Bytes = state.artifacts.get(artifact.content_hash.as_str()).await?;
    Ok((
        [(header::CONTENT_TYPE, artifact.media_type.to_string())],
        bytes,
    )
        .into_response())
}
