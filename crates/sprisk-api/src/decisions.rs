//! `GET /pipeline_versions/{id}/decisions` (ADR-0063 slice 5): what decided a flow version,
//! and whether each promise still holds on it. A version a person edited takes the decisions
//! of the walk that made its nearest ancestor.

use axum::Json;
use axum::extract::{Path, State};
use sprisk_contracts::{FlowDecisions, PipelineVersionId, parse};
use sprisk_methodology::flow_decisions::{flow_decisions, last_verify, while_head};

use crate::{ApiError, AppState, id};

pub(crate) async fn get_decisions(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<FlowDecisions>, ApiError> {
    let asked_id: PipelineVersionId = id(&raw)?;
    let asked = state.store.get_pipeline_version(&asked_id).await?;
    let Some((walk_id, made_at)) = state.store.walk_making_nearest(&asked.id).await? else {
        let none = serde_json::json!({ "schema_version": "sprisk.flow_decisions/v1",
                                       "pipeline_version_id": asked.id, "decisions": [] });
        return Ok(Json(
            parse(&none.to_string()).map_err(|e| ApiError::Internal(e.to_string()))?,
        ));
    };
    let all = state.store.walk_steps(&walk_id).await?;
    let steps = while_head(&all, made_at);
    let verified = match last_verify(steps).and_then(|s| s.pipeline_version_id.as_ref()) {
        Some(on) => Some(state.store.get_pipeline_version(on).await?),
        None => None,
    };
    let view = flow_decisions(&state.rules, &walk_id, steps, &asked, verified.as_ref())
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(view))
}
