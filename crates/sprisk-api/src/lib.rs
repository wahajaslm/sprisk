//! HTTP API: the one path UI, CLI, SDK and agents use (rule 4). Handlers hold no state;
//! the database is the truth.

use std::sync::Arc;

mod bounded;
mod figures;
mod kernel;
mod profile;
mod rules;
mod split;
pub use bounded::ProcessError;
pub use kernel::{KernelError, KernelLimits, Kernels};
pub use profile::Profiler;
pub use rules::RuleRunner;
pub use split::{SplitError, Splitter};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use sprisk_artifacts::ArtifactStore;
use sprisk_contracts::{
    AppliedMethodologyDecision, ApplyMethodologyDecision, ArtifactId, AttemptId, CapabilityClass,
    CodeSplit, CodeSplitRequest, CreateRun, DatasetProfile, DecisionProposal, FigureSet,
    InvestigationId, LoadedTable, LoadedTableUse, MethodologyDecision, MethodologyProposalId,
    MethodologyRule, MethodologyRuleSource, NotebookExecute, NotebookExecution,
    NotebookExecutionEvent, NotebookId, NotebookVariables, NotebookVersion, NotebookVersionId,
    Operator, OperatorSource, PipelineVersion, PipelineVersionId, Problem, QuestionVersion,
    QuestionVersionId, Run, RunId, parse,
};
use sprisk_core::time::now;
use sprisk_graph::{CompileError, Plan, compile};
use sprisk_registry::Registry;
use sprisk_scheduler::{ProcessWorkers, Scheduler, Settings};
use sprisk_store::{SqliteStore, StoreError};

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<SqliteStore>,
    pub artifacts: Arc<ArtifactStore>,
    pub registry: Arc<Registry>,
    /// Methodology rule manifests and their files (ADR-0042).
    pub rules: Arc<sprisk_methodology::RuleCatalog>,
    /// Methodology pack entrypoint run as Gate B before each run (ADR-0017).
    pub gate: Option<Operator>,
    /// Command that starts one Python worker.
    pub worker_command: Vec<String>,
    /// A started worker kept between runs, so an edit does not wait for one to start.
    pub idle_worker: sprisk_scheduler::IdleWorker,
    pub settings: Settings,
    /// Canonical directories local-path params may point into. Nothing else is readable.
    pub data_roots: Vec<std::path::PathBuf>,
    /// Reads notebook cells into suggested code steps (ADR-0031).
    pub splitter: Splitter,
    /// Profiles one table for the Datasets view (ADR-0038).
    pub profiler: Profiler,
    /// Runs a methodology rule's Python decide() (ADR-0042).
    pub rule_runner: RuleRunner,
    /// One live Python kernel per notebook being explored (ADR-0036).
    pub kernels: Kernels,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/pipeline_versions",
            post(create_pipeline_version).get(list_pipeline_versions),
        )
        .route(
            "/question_versions",
            post(create_question_version).get(list_question_versions),
        )
        .route("/question_versions/{id}", get(get_question_version))
        .route(
            "/pipeline_versions/{id}/methodology/split/{node_id}/proposals",
            post(propose_split),
        )
        .route(
            "/pipeline_versions/{id}/methodology/proposals/{node_id}",
            post(propose_node_methodology),
        )
        .route("/methodology_proposals/{id}", get(get_methodology_proposal))
        .route("/methodology_proposals/{id}/apply", post(apply_methodology))
        .route("/methodology_decisions", get(list_methodology_decisions))
        .route("/methodology_decisions/{id}", get(get_methodology_decision))
        .route("/methodology_rules", get(list_methodology_rules))
        .route(
            "/methodology_rules/{id}/source",
            get(get_methodology_rule_source),
        )
        .route("/operators", get(list_operators))
        .route("/operators/{id}/source", get(get_operator_source))
        .route("/code/split", post(split_code))
        .route("/pipeline_versions/{id}", get(get_pipeline_version))
        .route("/runs", post(create_run).get(list_runs))
        .route("/runs/{id}", get(get_run))
        .route("/runs/{id}/attempts", get(list_attempts))
        .route("/attempts/{id}/outputs", get(list_outputs))
        .route("/artifacts/{id}", get(get_artifact))
        .route("/artifacts/{id}/content", get(get_artifact_content))
        .route("/artifacts/{id}/rows", get(get_artifact_rows))
        .route("/artifacts/{id}/figures", get(get_artifact_figures))
        .route("/artifacts/{id}/profile", get(get_artifact_profile))
        .route("/loaded_tables", get(list_loaded_tables))
        .route("/notebook_versions", post(create_notebook_version))
        .route("/notebook_versions/{id}", get(get_notebook_version))
        .route("/notebooks", get(list_notebooks))
        .route("/notebooks/{id}/execute", post(execute_cell))
        .route("/notebooks/{id}/interrupt", post(interrupt_kernel))
        .route("/notebooks/{id}/restart", post(restart_kernel))
        .route("/notebooks/{id}/variables", get(kernel_variables))
        .layer(axum::middleware::from_fn(local_host_only))
        .with_state(state)
}

/// Refuse requests not addressed to this machine by name or loopback IP, and browser requests
/// from any non-local page. A rebinding page sends its own Host; a cross-site page sends its
/// own Origin; both are refused.
async fn local_host_only(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !is_local_name(host) {
        return ApiError::Forbidden(format!("host {host:?} is not local")).into_response();
    }
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        let origin = origin.to_str().unwrap_or("");
        let authority = origin
            .strip_prefix("http://")
            .or_else(|| origin.strip_prefix("https://"));
        if !authority.is_some_and(is_local_name) {
            return ApiError::Forbidden(format!("origin {origin:?} is not local")).into_response();
        }
    }
    next.run(request).await
}

/// `localhost`, `127.0.0.1` or `[::1]`, with or without a port.
fn is_local_name(authority: &str) -> bool {
    let name = match authority.rsplit_once(':') {
        Some((name, port)) if port.chars().all(|c| c.is_ascii_digit()) => name,
        _ => authority,
    };
    matches!(name, "127.0.0.1" | "localhost" | "[::1]")
}

/// Params marked `x-sprisk-local-path` in an operator's params_schema must resolve, after
/// following symlinks, inside one of the data roots.
fn check_local_paths(plan: &Plan, roots: &[std::path::PathBuf]) -> Result<(), ApiError> {
    let mut problems = Vec::new();
    for step in &plan.steps {
        let Some(properties) = step
            .operator
            .params_schema
            .get("properties")
            .and_then(|p| p.as_object())
        else {
            continue;
        };
        for (name, schema) in properties {
            if schema.get("x-sprisk-local-path") != Some(&serde_json::Value::Bool(true)) {
                continue;
            }
            let Some(raw) = step.params.get(name).and_then(|v| v.as_str()) else {
                continue;
            };
            let at = format!("node {} param {name}", step.node_id);
            match std::path::Path::new(raw).canonicalize() {
                Err(e) => problems.push(("path_not_found", format!("{at}: {raw}: {e}"))),
                Ok(path) if !roots.iter().any(|r| path.starts_with(r)) => problems.push((
                    "path_outside_data_roots",
                    format!("{at}: {} is outside the data roots", path.display()),
                )),
                Ok(_) => {}
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(ApiError::Policy(problems))
    }
}

#[derive(Debug, thiserror::Error)]
enum ApiError {
    #[error("{code}: {message}")]
    BadRequest { code: &'static str, message: String },
    #[error("invalid pipeline")]
    Compile(Vec<CompileError>),
    #[error("pipeline breaks local policy")]
    Policy(Vec<(&'static str, String)>),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Artifacts(#[from] sprisk_artifacts::StoreError),
    #[error(transparent)]
    Registry(#[from] sprisk_registry::RegistryError),
    #[error(transparent)]
    Rules(#[from] sprisk_methodology::CatalogError),
    #[error(transparent)]
    Split(#[from] SplitError),
    #[error(transparent)]
    Kernel(#[from] KernelError),
    #[error("profiling the table {0}")]
    Profile(#[from] ProcessError),
    #[error("running the methodology rule {0}")]
    Rule(ProcessError),
    #[error("{0}")]
    Internal(String),
}

impl ApiError {
    /// The status and `Problem` body this error answers with; a streamed cell's failure line
    /// carries the same body (ADR-0041).
    fn problem(&self) -> (StatusCode, serde_json::Value) {
        let (status, errors) = match self {
            ApiError::BadRequest { code, message } => {
                let status = if matches!(*code, "invalid_id" | "invalid_limit" | "invalid_offset") {
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
            ApiError::Policy(problems) => (StatusCode::UNPROCESSABLE_ENTITY, problems.clone()),
            ApiError::Forbidden(message) => {
                (StatusCode::FORBIDDEN, vec![("forbidden", message.clone())])
            }
            ApiError::Registry(
                sprisk_registry::RegistryError::UnknownOperator(_)
                | sprisk_registry::RegistryError::NoSource { .. },
            ) => (StatusCode::NOT_FOUND, vec![("not_found", self.to_string())]),
            ApiError::Rules(sprisk_methodology::CatalogError::UnknownRule(_)) => {
                (StatusCode::NOT_FOUND, vec![("not_found", self.to_string())])
            }
            ApiError::Store(StoreError::NotFound { .. }) => {
                (StatusCode::NOT_FOUND, vec![("not_found", self.to_string())])
            }
            ApiError::Artifacts(sprisk_artifacts::StoreError::NotATable { .. }) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                vec![("not_a_table", self.to_string())],
            ),
            ApiError::Split(SplitError::TooManyCells(_)) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                vec![("too_many_cells", self.to_string())],
            ),
            ApiError::Split(SplitError::Timeout(_)) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                vec![("split_timeout", self.to_string())],
            ),
            ApiError::Split(SplitError::Busy) => (
                StatusCode::TOO_MANY_REQUESTS,
                vec![("split_busy", self.to_string())],
            ),
            ApiError::Profile(ProcessError::Timeout(_)) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                vec![("profile_timeout", self.to_string())],
            ),
            ApiError::Rule(ProcessError::Timeout(_)) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                vec![("rule_timeout", self.to_string())],
            ),
            ApiError::Rule(ProcessError::Busy) => (
                StatusCode::TOO_MANY_REQUESTS,
                vec![("rule_busy", self.to_string())],
            ),
            ApiError::Profile(ProcessError::Busy) => (
                StatusCode::TOO_MANY_REQUESTS,
                vec![("profile_busy", self.to_string())],
            ),
            ApiError::Kernel(KernelError::TooMany(_)) => (
                StatusCode::TOO_MANY_REQUESTS,
                vec![("too_many_kernels", self.to_string())],
            ),
            ApiError::Kernel(KernelError::Stopped { .. }) => (
                StatusCode::SERVICE_UNAVAILABLE,
                vec![("kernel_stopped", self.to_string())],
            ),
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
        (status, body)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = self.problem();
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
    let plan = compile(&pipeline, &state.registry).map_err(ApiError::Compile)?;
    check_local_paths(&plan, &state.data_roots)?;
    if let Some(parent) = &pipeline.parent_id {
        match state.store.get_pipeline_version(parent).await {
            Err(StoreError::NotFound { .. }) => {
                return Err(ApiError::BadRequest {
                    code: "unknown_parent",
                    message: format!("parent pipeline version {} does not exist", parent.as_str()),
                });
            }
            other => other?,
        };
    }
    if let Some(question) = &pipeline.question_version_id {
        state
            .store
            .get_question_version(question)
            .await
            .map_err(|error| match error {
                StoreError::NotFound { .. } => ApiError::BadRequest {
                    code: "unknown_question_version",
                    message: format!("question version {} does not exist", question.as_str()),
                },
                other => ApiError::Store(other),
            })?;
    }
    check_notebook_sources(&state, &pipeline).await?;
    state.store.insert_pipeline_version(&pipeline).await?;
    Ok((StatusCode::CREATED, Json(pipeline)))
}

/// A node made from notebook cells (ADR-0036) cites saved cells of a notebook in the same
/// project. The version is immutable, so a citation that is wrong now stays wrong.
async fn check_notebook_sources(
    state: &AppState,
    pipeline: &PipelineVersion,
) -> Result<(), ApiError> {
    let refused = |code: &'static str, message: String| ApiError::BadRequest { code, message };
    for node in &pipeline.nodes {
        let Some(from) = &node.from_notebook else {
            continue;
        };
        let at = format!("node {}", node.id.as_str());
        let cited = match state
            .store
            .get_notebook_version(&from.notebook_version_id)
            .await
        {
            Err(StoreError::NotFound { .. }) => {
                let id = from.notebook_version_id.as_str();
                return Err(refused(
                    "unknown_notebook_version",
                    format!("{at}: notebook version {id} does not exist"),
                ));
            }
            other => other?,
        };
        if from
            .notebook_id
            .as_ref()
            .is_some_and(|n| *n != cited.notebook_id)
        {
            let version = cited.id.as_str();
            return Err(refused(
                "wrong_notebook",
                format!("{at}: notebook version {version} belongs to another notebook"),
            ));
        }
        if cited.project_id != pipeline.project_id {
            return Err(refused(
                "notebook_in_other_project",
                format!("{at}: its notebook is in another project"),
            ));
        }
        if from.cells.is_empty() {
            return Err(refused(
                "no_notebook_cells",
                format!("{at}: it names no notebook cells"),
            ));
        }
        if let Some(missing) = from
            .cells
            .iter()
            .find(|c| !cited.cells.iter().any(|saved| saved.id == **c))
        {
            let (cell, version) = (missing.as_str(), cited.id.as_str());
            return Err(refused(
                "unknown_notebook_cell",
                format!("{at}: notebook version {version} has no cell {cell}"),
            ));
        }
    }
    Ok(())
}

type Query = axum::extract::Query<std::collections::HashMap<String, String>>;

/// Page size from `?limit=`: 1..=200, default 50. Lists never return unbounded rows.
fn limit(query: &Query) -> Result<u32, ApiError> {
    let Some(raw) = query.get("limit") else {
        return Ok(50);
    };
    match raw.parse::<u32>() {
        Ok(n) if (1..=200).contains(&n) => Ok(n),
        _ => Err(ApiError::BadRequest {
            code: "invalid_limit",
            message: format!("limit must be 1..=200, got {raw}"),
        }),
    }
}

fn optional_id<T: std::str::FromStr>(query: &Query, key: &str) -> Result<Option<T>, ApiError> {
    query.get(key).map(|raw| id(raw)).transpose()
}

async fn list_methodology_rules(State(state): State<AppState>) -> Json<Vec<MethodologyRule>> {
    Json(state.rules.rules().cloned().collect())
}

async fn get_methodology_rule_source(
    State(state): State<AppState>,
    Path(rule_ref): Path<String>,
) -> Result<Json<MethodologyRuleSource>, ApiError> {
    Ok(Json(state.rules.source(&rule_ref)?.clone()))
}

async fn list_operators(State(state): State<AppState>) -> Json<Vec<Operator>> {
    Json(state.registry.operators().cloned().collect())
}

async fn split_code(
    State(state): State<AppState>,
    text: String,
) -> Result<Json<CodeSplit>, ApiError> {
    let request: CodeSplitRequest = body(&text)?;
    if let Some(range) = &request.together
        && range.first > range.last
    {
        return Err(ApiError::BadRequest {
            code: "invalid_cell_range",
            message: format!("cells {}..{} run backwards", range.first, range.last),
        });
    }
    Ok(Json(state.splitter.split(&request).await?))
}

async fn create_notebook_version(
    State(state): State<AppState>,
    text: String,
) -> Result<(StatusCode, Json<NotebookVersion>), ApiError> {
    let version: NotebookVersion = body(&text)?;
    if version.removed == Some(true) && version.parent_id.is_none() {
        return Err(ApiError::BadRequest {
            code: "removed_without_parent",
            message: format!(
                "notebook {} cannot be deleted in its first version",
                version.notebook_id.as_str()
            ),
        });
    }
    if let Some(parent) = &version.parent_id {
        let saved = match state.store.get_notebook_version(parent).await {
            Err(StoreError::NotFound { .. }) => {
                return Err(ApiError::BadRequest {
                    code: "unknown_parent",
                    message: format!("parent notebook version {} does not exist", parent.as_str()),
                });
            }
            other => other?,
        };
        if saved.project_id != version.project_id {
            return Err(ApiError::BadRequest {
                code: "parent_in_other_project",
                message: format!("parent {} is in another project", parent.as_str()),
            });
        }
        if saved.notebook_id != version.notebook_id {
            return Err(ApiError::BadRequest {
                code: "parent_in_other_notebook",
                message: format!(
                    "parent {} belongs to notebook {}, not {}",
                    parent.as_str(),
                    saved.notebook_id.as_str(),
                    version.notebook_id.as_str()
                ),
            });
        }
    } else if state.store.has_notebook(&version.notebook_id).await? {
        return Err(ApiError::Store(StoreError::Conflict(format!(
            "notebook {} already has a first version; save over its latest one",
            version.notebook_id.as_str()
        ))));
    }
    if let Some(flow) = &version.pipeline_version_id {
        let saved = match state.store.get_pipeline_version(flow).await {
            Err(StoreError::NotFound { .. }) => {
                return Err(ApiError::BadRequest {
                    code: "unknown_flow",
                    message: format!("flow version {} does not exist", flow.as_str()),
                });
            }
            other => other?,
        };
        if saved.project_id != version.project_id {
            return Err(ApiError::BadRequest {
                code: "flow_in_other_project",
                message: format!("flow version {} is in another project", flow.as_str()),
            });
        }
    }
    state.store.insert_notebook_version(&version).await?;
    Ok((StatusCode::CREATED, Json(version)))
}

async fn get_notebook_version(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<NotebookVersion>, ApiError> {
    let version_id: NotebookVersionId = id(&raw)?;
    Ok(Json(state.store.get_notebook_version(&version_id).await?))
}

async fn list_notebooks(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<NotebookVersion>>, ApiError> {
    Ok(Json(
        state.store.latest_notebook_versions(limit(&query)?).await?,
    ))
}

/// A notebook runs only once it is saved, so every kernel belongs to a known notebook.
async fn saved_notebook(state: &AppState, raw: &str) -> Result<NotebookId, ApiError> {
    let notebook: NotebookId = id(raw)?;
    if !state.store.has_notebook(&notebook).await? {
        return Err(ApiError::Store(StoreError::NotFound {
            entity: "notebook",
            id: raw.to_owned(),
        }));
    }
    Ok(notebook)
}

async fn execute_cell(
    State(state): State<AppState>,
    Path(raw): Path<String>,
    headers: axum::http::HeaderMap,
    text: String,
) -> Result<Response, ApiError> {
    let notebook = saved_notebook(&state, &raw).await?;
    let request: NotebookExecute = body(&text)?;
    // Scratch, not provenance (ADR-0036): the audit trail records that code ran and how it
    // ended, never its results. Written before the cell runs, so code that runs is audited
    // even when the caller goes away or the kernel dies.
    let cell = request.cell_id.as_str().to_owned();
    let hash = sprisk_artifacts::content_hash(request.code.as_bytes());
    let started = format!("cell {cell} started, code {hash}");
    state
        .store
        .append_audit(&now(), notebook.as_str(), &started)
        .await?;
    let streamed = headers
        .get(header::ACCEPT)
        .and_then(|a| a.to_str().ok())
        .is_some_and(|a| a.contains(NDJSON));
    if !streamed {
        let done = state.kernels.execute(&notebook, &request.code).await;
        audit_end(&state, &notebook, &cell, &done).await?;
        return Ok(Json(done?).into_response());
    }
    let (to, mut running) = tokio::sync::mpsc::channel(16);
    let task_state = state.clone();
    let cell_task = tokio::spawn(async move {
        let done = task_state
            .kernels
            .execute_with(&notebook, &request.code, Some(to))
            .await;
        // Audited here, so the end is written even when the browser has gone.
        audit_end(&task_state, &notebook, &cell, &done).await?;
        done.map_err(ApiError::from)
    });
    let Some(first) = running.recv().await else {
        // It ended before any output: a failure is a plain HTTP error, as without streaming.
        let done = finished(cell_task).await?;
        return Ok(ndjson(futures_util::stream::iter([done_line(done)])));
    };
    let lines = futures_util::stream::unfold(
        (Some(first), running, Some(cell_task)),
        |(first, mut running, task)| async move {
            if let Some(event) = first {
                return Some((event_line(&event), (None, running, task)));
            }
            if let Some(event) = running.recv().await {
                return Some((event_line(&event), (None, running, task)));
            }
            let line = match finished(task?).await {
                Ok(done) => done_line(done),
                Err(e) => failed_line(&e),
            };
            Some((line, (None, running, None)))
        },
    );
    Ok(ndjson(lines))
}

const NDJSON: &str = "application/x-ndjson";

async fn audit_end(
    state: &AppState,
    notebook: &NotebookId,
    cell: &str,
    done: &Result<NotebookExecution, KernelError>,
) -> Result<(), ApiError> {
    let ended = match done {
        Ok(done) => match done.execution_count {
            Some(n) => format!("cell {cell} ended: {}, execution {n}", done.status),
            None => format!("cell {cell} ended: {}", done.status),
        },
        Err(e) => format!("cell {cell} ended: kernel stopped ({e})"),
    };
    Ok(state
        .store
        .append_audit(&now(), notebook.as_str(), &ended)
        .await?)
}

async fn finished(
    task: tokio::task::JoinHandle<Result<NotebookExecution, ApiError>>,
) -> Result<NotebookExecution, ApiError> {
    task.await
        .map_err(|e| ApiError::Internal(format!("cell task: {e}")))?
}

/// One line of the stream. Every line is a contract value.
fn event_line(event: &NotebookExecutionEvent) -> String {
    serde_json::to_string(event).map_or_else(|e| internal_line(&e.to_string()), |l| l + "\n")
}

fn done_line(done: NotebookExecution) -> String {
    checked_line(json!({"kind": "done", "execution": done}))
}

fn failed_line(error: &ApiError) -> String {
    tracing::error!(%error, "streamed cell failed");
    checked_line(json!({"kind": "failed", "problem": error.problem().1}))
}

fn checked_line(value: serde_json::Value) -> String {
    match parse::<NotebookExecutionEvent>(&value.to_string()) {
        Ok(event) => event_line(&event),
        Err(e) => internal_line(&e.to_string()),
    }
}

fn internal_line(why: &str) -> String {
    tracing::error!(why, "invalid stream line");
    r#"{"kind":"failed","problem":{"errors":[{"code":"internal","message":"internal error"}]}}"#
        .to_owned()
        + "\n"
}

fn ndjson(lines: impl futures_util::Stream<Item = String> + Send + 'static) -> Response {
    use futures_util::StreamExt;
    let body = axum::body::Body::from_stream(lines.map(Ok::<_, std::convert::Infallible>));
    ([(header::CONTENT_TYPE, NDJSON)], body).into_response()
}

async fn interrupt_kernel(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<StatusCode, ApiError> {
    let notebook = saved_notebook(&state, &raw).await?;
    state.kernels.interrupt(&notebook).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restart_kernel(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<StatusCode, ApiError> {
    let notebook = saved_notebook(&state, &raw).await?;
    state.kernels.restart(&notebook).await;
    Ok(StatusCode::NO_CONTENT)
}

/// `?names=a,b`: which names the kernel holds and whether each is a table.
async fn kernel_variables(
    State(state): State<AppState>,
    Path(raw): Path<String>,
    query: Query,
) -> Result<Json<NotebookVariables>, ApiError> {
    let notebook = saved_notebook(&state, &raw).await?;
    let names: Vec<String> = query
        .get("names")
        .map(|n| n.split(',').map(str::to_owned).collect())
        .unwrap_or_default();
    for name in &names {
        if name.parse::<sprisk_contracts::PortName>().is_err() {
            return Err(ApiError::BadRequest {
                code: "invalid_id",
                message: format!("{name:?} is not a variable name a node can pass on"),
            });
        }
    }
    Ok(Json(state.kernels.variables(&notebook, &names).await?))
}

async fn get_operator_source(
    State(state): State<AppState>,
    Path(operator_ref): Path<String>,
) -> Result<Json<OperatorSource>, ApiError> {
    Ok(Json(state.registry.source(&operator_ref)?.clone()))
}

async fn list_pipeline_versions(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<PipelineVersion>>, ApiError> {
    let before: Option<PipelineVersionId> = optional_id(&query, "before")?;
    let versions = state
        .store
        .list_pipeline_versions(before.as_ref(), limit(&query)?)
        .await?;
    Ok(Json(versions))
}

async fn create_question_version(
    State(state): State<AppState>,
    text: String,
) -> Result<(StatusCode, Json<QuestionVersion>), ApiError> {
    let question: QuestionVersion = body(&text)?;
    if let Some(parent_id) = &question.parent_id {
        let parent =
            state
                .store
                .get_question_version(parent_id)
                .await
                .map_err(|error| match error {
                    StoreError::NotFound { .. } => ApiError::BadRequest {
                        code: "unknown_parent",
                        message: format!(
                            "parent question version {} does not exist",
                            parent_id.as_str()
                        ),
                    },
                    other => ApiError::Store(other),
                })?;
        if parent.investigation_id != question.investigation_id {
            return Err(ApiError::BadRequest {
                code: "different_investigation",
                message: "a question revision must keep its investigation id".into(),
            });
        }
    }
    state.store.insert_question_version(&question).await?;
    Ok((StatusCode::CREATED, Json(question)))
}

async fn list_question_versions(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<QuestionVersion>>, ApiError> {
    let investigation: Option<InvestigationId> = optional_id(&query, "investigation_id")?;
    let before: Option<QuestionVersionId> = optional_id(&query, "before")?;
    Ok(Json(
        state
            .store
            .list_question_versions(investigation.as_ref(), before.as_ref(), limit(&query)?)
            .await?,
    ))
}

async fn get_question_version(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<QuestionVersion>, ApiError> {
    Ok(Json(state.store.get_question_version(&id(&raw)?).await?))
}

async fn propose_split(
    State(state): State<AppState>,
    Path((raw, node_id)): Path<(String, String)>,
) -> Result<(StatusCode, Json<DecisionProposal>), ApiError> {
    propose(&state, &raw, &node_id, Some(SPLIT_RULE)).await
}

async fn propose_node_methodology(
    State(state): State<AppState>,
    Path((raw, node_id)): Path<(String, String)>,
) -> Result<(StatusCode, Json<DecisionProposal>), ApiError> {
    propose(&state, &raw, &node_id, None).await
}

const SPLIT_RULE: &str = "methodology.supervised.data_split@1.0.0";

/// What a rule reads besides the question.
#[derive(Clone, Copy, PartialEq)]
enum RuleInput {
    QuestionOnly,
    /// The measured train rows of the step it serves.
    TrainProfile,
}

/// The rule that decides a step with this operator (ADR-0042).
fn rule_for(operator: &str) -> Option<(&'static str, RuleInput)> {
    use RuleInput::*;
    Some(match operator.split('@').next()? {
        "sprisk.validation.random_split"
        | "sprisk.validation.temporal_split"
        | "sprisk.validation.group_split" => (SPLIT_RULE, QuestionOnly),
        "sprisk.clustering.kmeans" | "sprisk.clustering.dbscan" | "sprisk.clustering.gmm" => (
            "methodology.unsupervised.clustering_algorithm@1.0.0",
            QuestionOnly,
        ),
        "sprisk.clean.impute" | "sprisk.clean.drop_missing" => {
            ("methodology.supervised.missingness@1.0.0", TrainProfile)
        }
        "sprisk.clean.scale" => ("methodology.supervised.feature_scaling@1.0.0", TrainProfile),
        "sprisk.clean.clip_outliers" => (
            "methodology.supervised.outlier_treatment@1.0.0",
            TrainProfile,
        ),
        _ => return None,
    })
}

fn not_applicable(message: String) -> ApiError {
    ApiError::BadRequest {
        code: "methodology_not_applicable",
        message,
    }
}

fn evidence_unavailable(message: String) -> ApiError {
    ApiError::BadRequest {
        code: "methodology_evidence_unavailable",
        message,
    }
}

/// The proposal of the rule that decides `node_id`, decided by the rule's Python `decide()`.
/// `only` limits it to one rule. Every offered effect passes the compiler before it is stored.
async fn propose(
    state: &AppState,
    raw: &str,
    node_id: &str,
    only: Option<&str>,
) -> Result<(StatusCode, Json<DecisionProposal>), ApiError> {
    let pipeline = state.store.get_pipeline_version(&id(raw)?).await?;
    let question_id =
        pipeline
            .question_version_id
            .as_ref()
            .ok_or_else(|| ApiError::BadRequest {
                code: "question_required",
                message: "link a question revision to this flow before resolving methodology"
                    .into(),
            })?;
    let question = state.store.get_question_version(question_id).await?;
    let node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ApiError::BadRequest {
            code: "node_not_found",
            message: format!("node {node_id} does not exist"),
        })?;
    let (rule_ref, input) = rule_for(node.operator.as_str())
        .filter(|(rule_ref, _)| only.is_none_or(|only| only == *rule_ref))
        .ok_or_else(|| {
            not_applicable(format!(
                "no methodology rule decides operator {}",
                node.operator.as_str()
            ))
        })?;
    let profile = match input {
        RuleInput::QuestionOnly => Default::default(),
        RuleInput::TrainProfile => train_profile_facts(state, &pipeline, node).await?,
    };

    let rule = state.rules.rule(rule_ref)?;
    let resolve = |e: sprisk_methodology::ResolveError| not_applicable(e.to_string());
    let flow = sprisk_methodology::flow_facts(&pipeline, node_id);
    let observation =
        sprisk_methodology::observation(rule, &question, flow, profile).map_err(resolve)?;
    let decision = state
        .rule_runner
        .decide(state.rules.module(rule_ref)?, &observation)
        .await
        .map_err(ApiError::Rule)?;
    let proposal = sprisk_methodology::proposal(
        rule,
        &decision,
        &question,
        &pipeline,
        node_id,
        &format!("mpr_{}", ulid::Ulid::new()),
        &now(),
    )
    .map_err(resolve)?;

    let value =
        serde_json::to_value(&proposal).map_err(|error| ApiError::Internal(error.to_string()))?;
    for alternative in value["alternatives"].as_array().into_iter().flatten() {
        if alternative.get("effect").is_some() {
            let preview = materialize_effect(
                &pipeline,
                alternative,
                "plv_01JABCDEFGHJKMNPQRSTVWXYZ9",
                "mdc_01JABCDEFGHJKMNPQRSTVWXYZ9",
                &proposal.created_at.to_string(),
            )?;
            compile(&preview, &state.registry).map_err(ApiError::Compile)?;
        }
    }
    state.store.insert_methodology_proposal(&proposal).await?;
    Ok((StatusCode::CREATED, Json(proposal)))
}

/// Profile facts of the step's `columns`, measured on the table a split step's `train` port
/// gives it in this version's latest run. Only train rows: a rule that saw held-out rows
/// would leak them into the flow (rule 8). A version never changes, so its run matches it.
async fn train_profile_facts(
    state: &AppState,
    pipeline: &PipelineVersion,
    node: &sprisk_contracts::Node,
) -> Result<serde_json::Map<String, serde_json::Value>, ApiError> {
    let step = node.id.as_str();
    let source = pipeline
        .edges
        .iter()
        .find(|e| e.to.as_str() == format!("{step}.train"))
        .and_then(|e| e.from.as_str().split_once('.'))
        .filter(|(from, port)| {
            *port == "train"
                && pipeline.nodes.iter().any(|n| {
                    n.id.as_str() == *from
                        && rule_for(n.operator.as_str()).is_some_and(|(r, _)| r == SPLIT_RULE)
                })
        })
        .ok_or_else(|| {
            evidence_unavailable(format!(
                "step {step} must take its train rows from a split step's train output"
            ))
        })?;
    let columns: Vec<String> = node
        .params
        .get("columns")
        .and_then(|c| serde_json::from_value(c.clone()).ok())
        .ok_or_else(|| not_applicable(format!("step {step} names no list of columns")))?;
    let artifact = state
        .store
        .latest_outputs(std::slice::from_ref(&pipeline.id))
        .await?
        .into_iter()
        .find(|o| o.node_id == source.0 && o.port == "train")
        .map(|o| o.artifact)
        .ok_or_else(|| {
            evidence_unavailable(format!(
                "run the flow first: this rule measures the train rows {} gives step {step}",
                source.0
            ))
        })?;
    let profile = state.profiler.profile(&local_table(&artifact)?).await?;
    Ok(sprisk_methodology::profile_facts(&profile, &columns))
}

async fn apply_methodology(
    State(state): State<AppState>,
    Path(raw): Path<String>,
    text: String,
) -> Result<(StatusCode, Json<AppliedMethodologyDecision>), ApiError> {
    let proposal: DecisionProposal = state
        .store
        .get_methodology_proposal(&id::<MethodologyProposalId>(&raw)?)
        .await?;
    let request: ApplyMethodologyDecision = body(&text)?;
    if let Some(saved) = state
        .store
        .methodology_decision_by_key(request.idempotency_key.as_str())
        .await?
    {
        let saved_pipeline = state
            .store
            .get_pipeline_version(&saved.pipeline_version_id)
            .await?;
        return Ok((
            StatusCode::OK,
            Json(AppliedMethodologyDecision {
                decision: saved,
                pipeline: saved_pipeline,
            }),
        ));
    }
    let base = state
        .store
        .get_pipeline_version(&proposal.pipeline_version_id)
        .await?;
    if state.store.has_pipeline_child(&base.id).await? {
        return Err(ApiError::BadRequest {
            code: "stale_proposal",
            message: "the flow changed after this proposal; resolve it again".into(),
        });
    }
    let proposal_value =
        serde_json::to_value(&proposal).map_err(|error| ApiError::Internal(error.to_string()))?;
    let alternative = proposal_value["alternatives"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["id"] == request.alternative_id.as_str())
        })
        .ok_or_else(|| ApiError::BadRequest {
            code: "unknown_alternative",
            message: format!(
                "alternative {} is not in this proposal",
                request.alternative_id.as_str()
            ),
        })?;
    if alternative["applicability"] != "applicable" {
        return Err(ApiError::BadRequest {
            code: "missing_fact",
            message: alternative["reason"]
                .as_str()
                .unwrap_or("required evidence is missing")
                .into(),
        });
    }
    let at = now();
    let decision_id = format!("mdc_{}", ulid::Ulid::new());
    let pipeline_id = format!("plv_{}", ulid::Ulid::new());
    let pipeline = materialize_effect(&base, alternative, &pipeline_id, &decision_id, &at)?;
    compile(&pipeline, &state.registry).map_err(ApiError::Compile)?;
    let mut decision_json = json!({
        "schema_version":"sprisk.methodology_decision/v1", "id":decision_id,
        "proposal_id":proposal.id, "rule":proposal.rule,
        "question_version_id":proposal.question_version_id,
        "base_pipeline_version_id":proposal.pipeline_version_id,
        "pipeline_version_id":pipeline.id, "subject_node_id":proposal.subject_node_id,
        "alternative_id":request.alternative_id, "created_at":at
    });
    if let Some(reason) = &request.reason {
        decision_json["reason"] = json!(reason);
    }
    let decision: MethodologyDecision =
        parse(&decision_json.to_string()).map_err(|error| ApiError::Internal(error.to_string()))?;
    let saved = state
        .store
        .apply_methodology_decision(&decision, &pipeline, request.idempotency_key.as_str())
        .await?;
    let saved_pipeline = state
        .store
        .get_pipeline_version(&saved.pipeline_version_id)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(AppliedMethodologyDecision {
            decision: saved,
            pipeline: saved_pipeline,
        }),
    ))
}

fn materialize_effect(
    base: &PipelineVersion,
    alternative: &serde_json::Value,
    pipeline_id: &str,
    decision_id: &str,
    at: &str,
) -> Result<PipelineVersion, ApiError> {
    let effect = alternative
        .get("effect")
        .ok_or_else(|| ApiError::BadRequest {
            code: "no_effect",
            message: "this alternative cannot be applied until its facts are resolved".into(),
        })?;
    let node_id = effect["node_id"]
        .as_str()
        .ok_or_else(|| ApiError::Internal("effect has no node id".into()))?;
    let mut value =
        serde_json::to_value(base).map_err(|error| ApiError::Internal(error.to_string()))?;
    value["id"] = json!(pipeline_id);
    value["parent_id"] = json!(base.id);
    value["created_at"] = json!(at);
    let node = value["nodes"]
        .as_array_mut()
        .and_then(|nodes| nodes.iter_mut().find(|node| node["id"] == node_id))
        .ok_or_else(|| ApiError::BadRequest {
            code: "stale_proposal",
            message: format!("node {node_id} is no longer present"),
        })?;
    node["operator"] = effect["operator"].clone();
    node["params"] = effect["params"].clone();
    node["methodology_decision_id"] = json!(decision_id);
    parse(&value.to_string()).map_err(|error| ApiError::Internal(error.to_string()))
}

async fn list_methodology_decisions(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<MethodologyDecision>>, ApiError> {
    let pipeline: Option<PipelineVersionId> = optional_id(&query, "pipeline_version_id")?;
    Ok(Json(
        state
            .store
            .list_methodology_decisions(pipeline.as_ref())
            .await?,
    ))
}

async fn get_methodology_proposal(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<DecisionProposal>, ApiError> {
    Ok(Json(
        state.store.get_methodology_proposal(&id(&raw)?).await?,
    ))
}

async fn get_methodology_decision(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<MethodologyDecision>, ApiError> {
    Ok(Json(
        state.store.get_methodology_decision(&id(&raw)?).await?,
    ))
}

async fn list_runs(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<Run>>, ApiError> {
    let pipeline: Option<PipelineVersionId> = optional_id(&query, "pipeline_version_id")?;
    let before: Option<RunId> = optional_id(&query, "before")?;
    let runs = state
        .store
        .list_runs(pipeline.as_ref(), before.as_ref(), limit(&query)?)
        .await?;
    Ok(Json(runs))
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
    // Checked again: the files or the configured roots may have changed since submit.
    check_local_paths(&plan, &state.data_roots)?;
    // An edit reuses the run on screen up to the edited step (ADR-0026); it must exist and
    // belong to the same project, or its results are not ours to reuse.
    if let Some(reuse) = &request.reuse_run_id {
        let earlier = state.store.get_run(reuse).await?;
        if earlier.project_id != pipeline.project_id {
            return Err(ApiError::Forbidden(format!(
                "run {} is in another project",
                reuse.as_str()
            )));
        }
    }
    let now = sprisk_core::time::now();
    let mut doc = json!({
        "schema_version": "sprisk.run/v1",
        "id": format!("run_{}", ulid::Ulid::new()),
        "project_id": pipeline.project_id,
        "pipeline_version_id": pipeline.id,
        "status": "queued",
        "created_at": now,
    });
    if let Some(reuse) = &request.reuse_run_id {
        doc["reuse_run_id"] = json!(reuse);
    }
    let run: Run = parse(&doc.to_string()).map_err(|e| ApiError::Internal(e.to_string()))?;
    state.store.insert_run(&run).await?;

    // Local mode runs in this process; the database stays the truth, so a restart
    // can resume the run (backlog: separate runner process).
    let run_id = run.id.clone();
    tokio::spawn(async move {
        let workers = ProcessWorkers {
            command: state.worker_command.clone(),
            idle: state.idle_worker.clone(),
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
        if let Some(reuse) = request.reuse_run_id {
            scheduler = scheduler.reusing(reuse);
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

/// Safety ceiling on what the browser may fetch to show (ADR-0027). Each renderer has its own,
/// lower cap in the browser; this only stops a mistake from pulling a huge artifact.
const MAX_DISPLAY_BYTES: u64 = 32 * 1024 * 1024;

/// Content over the display cap is refused unless the caller asks for a download (`?download=true`).
fn display_size(size_bytes: u64, download: bool) -> Result<(), ApiError> {
    if download || size_bytes <= MAX_DISPLAY_BYTES {
        return Ok(());
    }
    Err(ApiError::BadRequest {
        code: "too_large",
        message: format!(
            "artifact is {size_bytes} bytes, over the {MAX_DISPLAY_BYTES}-byte display cap; add ?download=true"
        ),
    })
}

async fn get_artifact_content(
    State(state): State<AppState>,
    Path(raw): Path<String>,
    query: Query,
) -> Result<Response, ApiError> {
    let artifact_id: ArtifactId = id(&raw)?;
    let artifact = state.store.get_artifact(&artifact_id).await?;
    let download = query.get("download").is_some_and(|v| v == "true");
    display_size(artifact.size_bytes, download)?;
    let bytes: Bytes = state.artifacts.get(artifact.content_hash.as_str()).await?;
    // Always a download: the browser must never render artifact bytes on the API origin.
    Ok((
        [
            (header::CONTENT_TYPE, artifact.media_type.to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", artifact.id.as_str()),
            ),
        ],
        bytes,
    )
        .into_response())
}

const PARQUET: &str = "application/vnd.apache.parquet";

/// One page of a Parquet artifact as display rows. The browser never gets the table itself.
async fn get_artifact_rows(
    State(state): State<AppState>,
    Path(raw): Path<String>,
    query: Query,
) -> Result<Json<sprisk_contracts::TablePage>, ApiError> {
    let artifact_id: ArtifactId = id(&raw)?;
    let offset = match query.get("offset") {
        None => 0,
        Some(raw) => raw.parse::<u64>().map_err(|_| ApiError::BadRequest {
            code: "invalid_offset",
            message: format!("offset must be a whole number >= 0, got {raw}"),
        })?,
    };
    let limit = limit(&query)?;
    let artifact = state.store.get_artifact(&artifact_id).await?;
    if artifact.media_type.as_str() != PARQUET {
        return Err(ApiError::BadRequest {
            code: "not_a_table",
            message: format!(
                "artifact {raw} is {}, not a table",
                artifact.media_type.as_str()
            ),
        });
    }
    let page = state
        .artifacts
        .read_table_page(artifact.content_hash.as_str(), offset, limit)
        .await?;
    Ok(Json(page))
}

/// The first figures in a figures or display report. A card previews one figure without
/// fetching the tables a code step showed beside it (ADR-0027).
async fn get_artifact_figures(
    State(state): State<AppState>,
    Path(raw): Path<String>,
    query: Query,
) -> Result<Json<FigureSet>, ApiError> {
    let artifact_id: ArtifactId = id(&raw)?;
    let limit = limit(&query)?;
    let artifact = state.store.get_artifact(&artifact_id).await?;
    display_size(artifact.size_bytes, false)?;
    let not_figures = |why: String| ApiError::BadRequest {
        code: "not_figures",
        message: format!("artifact {raw} is {why}"),
    };
    if artifact.media_type.as_str() != "application/json" {
        return Err(not_figures(artifact.media_type.to_string()));
    }
    let bytes = state.artifacts.get(artifact.content_hash.as_str()).await?;
    let report = std::str::from_utf8(&bytes).map_err(|e| not_figures(format!("not text: {e}")))?;
    let set =
        figures::first_figures(report, limit as usize).map_err(|e| not_figures(e.to_string()))?;
    Ok(Json(set))
}

/// A descriptive profile of one table, computed by Python (ADR-0038). The browser gets
/// counts and shares, never rows.
async fn get_artifact_profile(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<DatasetProfile>, ApiError> {
    let artifact_id: ArtifactId = id(&raw)?;
    let artifact = state.store.get_artifact(&artifact_id).await?;
    if artifact.media_type.as_str() != PARQUET {
        return Err(ApiError::BadRequest {
            code: "not_a_table",
            message: format!(
                "artifact {raw} is {}, not a table",
                artifact.media_type.as_str()
            ),
        });
    }
    Ok(Json(
        state.profiler.profile(&local_table(&artifact)?).await?,
    ))
}

/// The local file behind a table artifact; only local tables can be profiled yet.
fn local_table(artifact: &sprisk_contracts::Artifact) -> Result<std::path::PathBuf, ApiError> {
    let uri = artifact.uri.as_str();
    url::Url::parse(uri)
        .ok()
        .and_then(|u| u.to_file_path().ok())
        .ok_or_else(|| ApiError::BadRequest {
            code: "not_local",
            message: format!(
                "artifact {} is at {uri}; only local tables can be profiled yet",
                artifact.id.as_str()
            ),
        })
}

/// The tables flows load (ADR-0038): each source step's latest output in the newest pipeline
/// versions. Tables with the same content are listed once, with every step that loads them.
/// Newest first.
async fn list_loaded_tables(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<LoadedTable>>, ApiError> {
    let versions = state
        .store
        .list_pipeline_versions(None, limit(&query)?)
        .await?;
    let mut sources = std::collections::HashMap::new();
    for version in &versions {
        for node in &version.nodes {
            let source = state
                .registry
                .get(node.operator.as_str())
                .is_some_and(|op| op.capability_class == CapabilityClass::Source);
            if !source {
                continue;
            }
            let file = node.params.get("path").and_then(|p| p.as_str());
            let name = file
                .and_then(|p| std::path::Path::new(p).file_name())
                .map_or_else(|| node.id.to_string(), |n| n.to_string_lossy().into_owned());
            sources.insert((version.id.clone(), node.id.to_string()), (name, node));
        }
    }
    let ids: Vec<_> = versions.iter().map(|v| v.id.clone()).collect();
    let mut tables: Vec<LoadedTable> = Vec::new();
    let mut by_hash: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for output in state.store.latest_outputs(&ids).await? {
        if output.artifact.media_type.as_str() != PARQUET {
            continue;
        }
        let key = (output.pipeline_version_id.clone(), output.node_id.clone());
        let Some((name, node)) = sources.get(&key) else {
            continue;
        };
        let used = LoadedTableUse {
            pipeline_version_id: output.pipeline_version_id,
            run_id: output.run_id,
            node_id: node.id.clone(),
        };
        let hash = output.artifact.content_hash.to_string();
        if let Some(&at) = by_hash.get(&hash) {
            tables[at].used_by.push(used);
            continue;
        }
        let (total_rows, total_columns) = state.artifacts.table_shape(&hash).await?;
        by_hash.insert(hash, tables.len());
        tables.push(LoadedTable {
            name: name.clone(),
            operator: node.operator.clone(),
            artifact: output.artifact,
            total_rows,
            total_columns,
            used_by: vec![used],
        });
    }
    Ok(Json(tables))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_over_the_display_cap_is_refused_unless_downloaded() {
        assert!(display_size(MAX_DISPLAY_BYTES, false).is_ok());
        let refused = display_size(MAX_DISPLAY_BYTES + 1, false);
        assert!(matches!(
            refused,
            Err(ApiError::BadRequest {
                code: "too_large",
                ..
            })
        ));
        assert!(display_size(MAX_DISPLAY_BYTES + 1, true).is_ok());
    }
}
