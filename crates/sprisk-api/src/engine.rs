//! Walks (ADR-0060): the engine builds a flow from a question and its sources, then reviews,
//! applies and runs it through the same functions as the HTTP routes, until it must stop.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sprisk_contracts::{
    AppliedMethodologyDecision, AttemptState, CreateWalk, DecisionProposal, MethodologyReviewItem,
    PipelineVersion, PipelineVersionId, RunId, RunStatus, Walk, WalkAction, WalkDetail, WalkId,
    WalkStatus, WalkStep, WalkStopReason, parse,
};
use sprisk_core::time::format;
use sprisk_methodology::engine::{Action, HeadRun, Start, next_action, start};

use crate::{
    ApiError, AppState, Claimed, NOT_COMPARED, NOTHING_TO_COMPARE, apply_methodology, body,
    check_local_paths, claim_selection, compile, decision_of, drive_run, id, propose, queued_run,
    review_methodology,
};

/// What the loop-back rule decides; its `max_looks` caps the walk's comparisons too, so the
/// cap has one source.
const LOOP_BACK: &str = "evaluation.loop_back";

const MAX_ACTIONS: u64 = 200;
const MAX_WALL_SECONDS: u64 = 7 * 24 * 60 * 60;

/// Starts a walk: builds the first flow and stores it with the walk, then walks on in the
/// background. A replayed key gets the saved walk and starts nothing.
pub(crate) async fn create_walk(
    State(state): State<AppState>,
    text: String,
) -> Result<(StatusCode, Json<Walk>), ApiError> {
    let request: CreateWalk = body(&text)?;
    check_budget(&request)?;
    let question = state
        .store
        .get_question_version(&request.question_version_id)
        .await?;
    let sources: Vec<String> = request.sources.iter().map(|s| s.to_string()).collect();
    let started = start(&question, &sources).map_err(|e| ApiError::BadRequest {
        code: "invalid_walk",
        message: e.to_string(),
    })?;
    // The walk's clock, so its deadline and its records read the same time.
    let at = format((state.clock)());
    let walk_id = format!("wlk_{}", ulid::Ulid::new());
    let mut walk = json!({
        "schema_version": "sprisk.walk/v1", "id": walk_id, "project_id": request.project_id,
        "question_version_id": request.question_version_id, "sources": request.sources,
        "max_actions": request.max_actions, "max_wall_seconds": request.max_wall_seconds,
        "status": "walking", "created_at": at,
    });
    let (first, step) = match started {
        Start::Flow { nodes, edges } => {
            let first: PipelineVersion = internal(parse(
                &json!({
                    "schema_version": "sprisk.pipeline_version/v1",
                    "id": format!("plv_{}", ulid::Ulid::new()),
                    "project_id": request.project_id,
                    "question_version_id": request.question_version_id,
                    "nodes": nodes, "edges": edges, "created_at": at,
                })
                .to_string(),
            ))?;
            let plan = compile(&first, &state.registry).map_err(ApiError::Compile)?;
            check_local_paths(&plan, &state.data_roots)?;
            walk["source_hashes"] = json!(hash_sources(&sources).await?);
            walk["head_pipeline_version_id"] = json!(first.id);
            let reason = "Load, Split and a baseline model: the steps every flow has.";
            let made = json!({ "made_pipeline_version_id": first.id });
            let step = step(&state, &walk_id, 0, WalkAction::Build, reason, made)?;
            (Some(first), step)
        }
        Start::Stop { reason, detail } => {
            walk["status"] = json!(WalkStatus::Stopped);
            walk["stop"] = json!({ "reason": reason, "detail": detail });
            walk["finished_at"] = json!(at);
            let step = step(&state, &walk_id, 0, WalkAction::Stop, &detail, json!({}))?;
            (None, step)
        }
    };
    let walk: Walk = internal(parse(&walk.to_string()))?;
    let (walk, created) = state
        .store
        .insert_walk(&walk, &request, first.as_ref(), &step)
        .await?;
    if !created {
        return Ok((StatusCode::OK, Json(walk)));
    }
    if walk.status == WalkStatus::Stopped {
        return Ok((StatusCode::CREATED, Json(walk)));
    }
    let (state, id) = (state.clone(), walk.id.clone());
    tokio::spawn(async move { walk_on(&state, &id).await });
    Ok((StatusCode::ACCEPTED, Json(walk)))
}

fn check_budget(request: &CreateWalk) -> Result<(), ApiError> {
    if !(1..=MAX_ACTIONS).contains(&request.max_actions)
        || !(1..=MAX_WALL_SECONDS).contains(&request.max_wall_seconds)
    {
        return Err(ApiError::BadRequest {
            code: "invalid_budget",
            message: format!(
                "max_actions must be 1 to {MAX_ACTIONS}, and max_wall_seconds 1 to {MAX_WALL_SECONDS}"
            ),
        });
    }
    Ok(())
}

pub(crate) async fn get_walk(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<WalkDetail>, ApiError> {
    let walk_id: WalkId = id(&raw)?;
    let walk = state.store.get_walk(&walk_id).await?;
    let steps = state.store.walk_steps(&walk_id).await?;
    Ok(Json(WalkDetail { walk, steps }))
}

/// Takes rounds until the walk stops. An error stops it too, with the error as its detail,
/// so a walk never stays `walking` with nothing driving it.
async fn walk_on(state: &AppState, walk_id: &WalkId) {
    loop {
        match round(state, walk_id).await {
            Ok(WalkStatus::Walking) => continue,
            Ok(WalkStatus::Stopped) => return,
            Err(error) => {
                tracing::error!(walk = walk_id.as_str(), error = %error, "walk stopped");
                let ended = async {
                    let walk = state.store.get_walk(walk_id).await?;
                    let round = state.store.walk_steps(walk_id).await?.len();
                    let detail = format!("The engine could not take its next step: {error}");
                    record_stop(state, walk, round, WalkStopReason::Error, &detail).await
                };
                if let Err(e) = ended.await {
                    tracing::error!(walk = walk_id.as_str(), error = %e, "could not record how the walk ended");
                }
                return;
            }
        }
    }
}

/// One round: check the budget and the head, review the head, then apply, run or stop.
async fn round(state: &AppState, walk_id: &WalkId) -> Result<WalkStatus, ApiError> {
    let walk = state.store.get_walk(walk_id).await?;
    if walk.status == WalkStatus::Stopped {
        return Ok(WalkStatus::Stopped);
    }
    let steps = state.store.walk_steps(walk_id).await?;
    let round = steps.len();
    let head = walk.head_pipeline_version_id.clone().ok_or_else(|| {
        ApiError::Internal(format!("walk {} is walking with no head", walk_id.as_str()))
    })?;
    let acted = steps
        .iter()
        .filter(|s| {
            matches!(
                s.action,
                WalkAction::Apply | WalkAction::Run | WalkAction::Compare
            )
        })
        .count();
    if acted as u64 >= walk.max_actions {
        let detail = format!("The walk took its {} actions.", walk.max_actions);
        return record_stop(state, walk, round, WalkStopReason::BudgetExhausted, &detail).await;
    }
    let deadline = deadline(&walk)?;
    if (state.clock)() >= deadline {
        let detail = format!("The walk used its {} seconds.", walk.max_wall_seconds);
        return record_stop(state, walk, round, WalkStopReason::BudgetExhausted, &detail).await;
    }
    if state.store.has_pipeline_child(&head).await? {
        let detail = format!(
            "Version {} gained a version the walk did not make.",
            head.as_str()
        );
        return record_stop(state, walk, round, WalkStopReason::Stale, &detail).await;
    }

    if let Some(changed) = changed_source(&walk).await? {
        return record_stop(state, walk, round, WalkStopReason::SourceChanged, &changed).await;
    }

    let head_run = head_run(state, &steps, &head).await?;
    let Json(review) = review_methodology(State(state.clone()), Path(head.to_string())).await?;
    let question = state
        .store
        .get_question_version(&walk.question_version_id)
        .await?;
    let action = next_action(&review, &question, head_run, &state.rules).map_err(|e| match e {
        sprisk_methodology::ResolveError::Rules(rules) => ApiError::Rules(rules),
        other => ApiError::Internal(other.to_string()),
    })?;
    // Again before acting on the review: a source written while it ran is caught now.
    if let Some(changed) = changed_source(&walk).await? {
        return record_stop(state, walk, round, WalkStopReason::SourceChanged, &changed).await;
    }
    match action {
        Action::Apply {
            item,
            subject,
            alternative,
            ..
        } => {
            let (_, Json(proposal)) =
                propose(state, head.as_str(), subject, Some(item.decides.as_str())).await?;
            let applying = Applying {
                item,
                proposal: &proposal,
                alternative,
                reason: item.reason.as_str(),
            };
            apply(state, walk, round, &head, applying).await
        }
        Action::Compare { item, subject } => {
            compare(state, walk, round, &head, deadline, item, subject).await
        }
        Action::Run { reason } => run(state, walk, round, &head, deadline, &reason).await,
        Action::Stop {
            reason: WalkStopReason::RunFailed,
            detail,
        } => {
            let failed = failed_steps(state, &steps, &head).await?;
            let detail = format!("{failed} Still open: {detail}");
            record_stop(state, walk, round, WalkStopReason::RunFailed, &detail).await
        }
        Action::Stop { reason, detail } => record_stop(state, walk, round, reason, &detail).await,
    }
}

/// Each source's SHA-256, in order, as the walk begins.
async fn hash_sources(sources: &[String]) -> Result<Vec<String>, ApiError> {
    let mut hashes = Vec::with_capacity(sources.len());
    for source in sources {
        let hash = sprisk_artifacts::file_hash(std::path::Path::new(source))
            .await
            .map_err(|e| ApiError::BadRequest {
                code: "invalid_walk",
                message: format!("source {source} cannot be read: {e}"),
            })?;
        hashes.push(hash);
    }
    Ok(hashes)
}

/// Why a source no longer holds what it held when the walk began, if one does not: the rules
/// judged those rows, and a run of new ones would be judged by nothing (ADR-0060). A source
/// that cannot be read is an error. A walk made before hashes were recorded has none to check.
async fn changed_source(walk: &Walk) -> Result<Option<String>, ApiError> {
    let hashes = &walk.source_hashes;
    if !hashes.is_empty() && hashes.len() != walk.sources.len() {
        return Err(ApiError::Internal(format!(
            "walk {} has {} sources but {} hashes",
            walk.id.as_str(),
            walk.sources.len(),
            hashes.len()
        )));
    }
    for (source, began) in walk.sources.iter().zip(hashes) {
        let source = source.to_string();
        let now = sprisk_artifacts::file_hash(std::path::Path::new(&source))
            .await
            .map_err(|e| ApiError::Internal(format!("source {source}: {e}")))?;
        if now != began.as_str() {
            return Ok(Some(format!(
                "Source {source} changed since the walk began: it held {}, now {now}. Walk \
                 again to judge the new rows.",
                began.as_str()
            )));
        }
    }
    Ok(None)
}

/// A rule's recommended alternative the walk applies, and the proposal it comes from.
struct Applying<'a> {
    item: &'a MethodologyReviewItem,
    proposal: &'a DecisionProposal,
    alternative: &'a str,
    reason: &'a str,
}

/// When the walk's time runs out: its wall budget after it was created.
fn deadline(walk: &Walk) -> Result<jiff::Timestamp, ApiError> {
    let created: jiff::Timestamp = walk
        .created_at
        .to_string()
        .parse()
        .map_err(|e: jiff::Error| ApiError::Internal(e.to_string()))?;
    let budget = i64::try_from(walk.max_wall_seconds).map_err(|_| {
        ApiError::Internal(format!("walk {} has no usable budget", walk.id.as_str()))
    })?;
    created
        .checked_add(jiff::SignedDuration::from_secs(budget))
        .map_err(|e| ApiError::Internal(e.to_string()))
}

/// The walk's run of `head`, if it ran it.
fn head_run_id(steps: &[WalkStep], head: &PipelineVersionId) -> Option<RunId> {
    steps
        .iter()
        .rev()
        .find(|s| s.action == WalkAction::Run && s.pipeline_version_id.as_ref() == Some(head))
        .and_then(|s| s.run_id.clone())
}

/// How the walk's run of `head` ended, if it ran it. The walk drives each run to its end
/// before its next round.
async fn head_run(
    state: &AppState,
    steps: &[WalkStep],
    head: &PipelineVersionId,
) -> Result<HeadRun, ApiError> {
    let Some(run_id) = head_run_id(steps, head) else {
        return Ok(HeadRun::NotRun);
    };
    match state.store.get_run(&run_id).await?.status {
        RunStatus::Succeeded => Ok(HeadRun::Succeeded),
        RunStatus::Failed | RunStatus::Cancelled => Ok(HeadRun::Failed),
        unfinished => Err(ApiError::Internal(format!(
            "run {} of the head is still {unfinished}",
            run_id.as_str()
        ))),
    }
}

/// Which steps of the walk's run of `head` failed, and why, for a person to read.
async fn failed_steps(
    state: &AppState,
    steps: &[WalkStep],
    head: &PipelineVersionId,
) -> Result<String, ApiError> {
    match head_run_id(steps, head) {
        Some(run_id) => failed_attempts(state, &run_id).await,
        None => Ok(String::new()),
    }
}

/// Which steps of `run_id` failed, and why.
async fn failed_attempts(state: &AppState, run_id: &RunId) -> Result<String, ApiError> {
    let failed: Vec<String> = state
        .store
        .list_attempts(run_id)
        .await?
        .iter()
        .filter(|a| a.state == AttemptState::Failed)
        .map(|a| match &a.error {
            Some(error) => format!(
                "step {} failed: {}.",
                a.node_id.as_str(),
                error.message.as_str()
            ),
            None => format!("step {} failed.", a.node_id.as_str()),
        })
        .collect();
    Ok(format!("Run {}: {}", run_id.as_str(), failed.join(" ")))
}

/// Compares the routes of `item`'s rule on step `subject` through the same model selection as
/// a person (ADR-0050): on fixed folds with a fixed seed. The round that starts it drives its
/// run to the end or the walk's deadline; the next applies its winner, or stops when none
/// beats the baseline.
async fn compare(
    state: &AppState,
    walk: Walk,
    round: usize,
    head: &PipelineVersionId,
    deadline: jiff::Timestamp,
    item: &MethodologyReviewItem,
    subject: &str,
) -> Result<WalkStatus, ApiError> {
    // A new comparison is a new look at the folds; past the cap, more looks would fit them.
    let fresh = state
        .store
        .selection_for(head, &id(subject)?)
        .await?
        .is_none();
    let looks = state.store.looks(head).await?;
    let most = max_looks(state)?;
    if fresh && looks >= most {
        let detail = format!(
            "{} (step {subject}): the flow has looked at its folds {looks} times, the most \
             allowed ({most}); more comparisons would fit the folds.",
            item.decides.as_str()
        );
        return record_stop(state, walk, round, WalkStopReason::Limitation, &detail).await;
    }
    let Claimed {
        selection,
        plan: claimed,
        ..
    } = match claim_selection(state, head.as_str(), subject).await {
        Ok(claimed) => claimed,
        Err(ApiError::BadRequest { code, message })
            if code == NOT_COMPARED || code == NOTHING_TO_COMPARE =>
        {
            let detail = format!("{} ({code}: {message})", item.decides.as_str());
            return record_stop(state, walk, round, WalkStopReason::Uncovered, &detail).await;
        }
        Err(other) => return Err(other),
    };
    if selection.proposal.rule.as_str() != item.rule.as_str() {
        let detail = format!(
            "{}: step {subject} is compared for {}, not for this rule.",
            item.decides.as_str(),
            selection.proposal.rule.as_str()
        );
        return record_stop(state, walk, round, WalkStopReason::Uncovered, &detail).await;
    }
    let run_id = selection.run.id.clone();
    if let Some(plan) = claimed {
        let compared = json!({
            "pipeline_version_id": head, "rule": item.rule, "decides": item.decides,
            "subject_node_id": subject, "run_id": run_id,
        });
        let reason = item.reason.as_str();
        let step = step(
            state,
            walk.id.as_str(),
            round,
            WalkAction::Compare,
            reason,
            compared,
        )?;
        state.store.record_walk_step(&walk, &step).await?;
        let comparison = &selection.comparison;
        drive_run(state, &run_id, comparison, &plan, None, Some(deadline))
            .await
            .map_err(|e| ApiError::Internal(format!("run {}: {e}", run_id.as_str())))?;
        return Ok(WalkStatus::Walking);
    }
    let ended = state.store.get_run(&run_id).await?.status;
    if matches!(ended, RunStatus::Queued | RunStatus::Running) {
        // Started by a person, or left by a walk that stopped mid-run: walk again once it ends.
        let detail = format!(
            "The comparison for {} is still {ended} in run {}; walk again once it ends.",
            item.decides.as_str(),
            run_id.as_str()
        );
        return record_stop(state, walk, round, WalkStopReason::Error, &detail).await;
    }
    if ended != RunStatus::Succeeded {
        let failed = failed_attempts(state, &run_id).await?;
        let detail = format!(
            "The comparison for {} ended {ended}. {failed}",
            item.decides.as_str()
        );
        return record_stop(state, walk, round, WalkStopReason::RunFailed, &detail).await;
    }
    let (decision, _) = decision_of(state, &selection.comparison)
        .await?
        .ok_or_else(|| ApiError::Internal(format!("comparison of {subject} decided nothing")))?;
    let Some(winner) = &decision.winner else {
        let detail = format!(
            "{} (step {subject}): no candidate beats the baseline on the same folds. {}",
            item.decides.as_str(),
            decision.reason.as_str()
        );
        return record_stop(state, walk, round, WalkStopReason::Limitation, &detail).await;
    };
    let applying = Applying {
        item,
        proposal: &selection.proposal,
        alternative: winner.as_str(),
        reason: decision.reason.as_str(),
    };
    apply(state, walk, round, head, applying).await
}

/// Applies `alternative` to step `subject` through the same Apply as a person, keyed by the
/// walk and round, so a repeated round gets the saved decision.
async fn apply(
    state: &AppState,
    mut walk: Walk,
    round: usize,
    head: &PipelineVersionId,
    Applying {
        item,
        proposal,
        alternative,
        reason,
    }: Applying<'_>,
) -> Result<WalkStatus, ApiError> {
    let choice = json!({
        "alternative_id": alternative,
        "idempotency_key": format!("{}-round-{round}", walk.id.as_str()),
    });
    let applied = apply_methodology(
        State(state.clone()),
        Path(proposal.id.to_string()),
        choice.to_string(),
    )
    .await;
    let (decision, pipeline) = match applied {
        Ok((_, Json(AppliedMethodologyDecision { decision, pipeline }))) => (decision, pipeline),
        // Someone changed the head while this round reviewed it.
        Err(ApiError::BadRequest {
            code: "stale_proposal",
            message,
        }) => {
            return record_stop(state, walk, round, WalkStopReason::Stale, &message).await;
        }
        Err(other) => return Err(other),
    };
    let made = json!({
        "pipeline_version_id": head, "rule": item.rule, "decides": item.decides,
        "subject_node_id": proposal.subject_node_id, "alternative_id": alternative,
        "methodology_decision_id": decision.id, "made_pipeline_version_id": pipeline.id,
    });
    let step = step(
        state,
        walk.id.as_str(),
        round,
        WalkAction::Apply,
        reason,
        made,
    )?;
    walk.head_pipeline_version_id = Some(pipeline.id);
    state.store.record_walk_step(&walk, &step).await?;
    Ok(WalkStatus::Walking)
}

/// Runs the head to its end, or to the walk's deadline. The step is recorded before the run
/// is driven, so the trail names the run even if the server stops during it.
async fn run(
    state: &AppState,
    walk: Walk,
    round: usize,
    head: &PipelineVersionId,
    deadline: jiff::Timestamp,
    reason: &str,
) -> Result<WalkStatus, ApiError> {
    let pipeline = state.store.get_pipeline_version(head).await?;
    let (queued, plan) = queued_run(state, &pipeline).await?;
    state.store.insert_run(&queued).await?;
    let ran = json!({ "pipeline_version_id": head, "run_id": queued.id });
    let step = step(state, walk.id.as_str(), round, WalkAction::Run, reason, ran)?;
    state.store.record_walk_step(&walk, &step).await?;
    // drive_run logs a run that stops. The next round reads how the run ended, and its review
    // may still act on what a failed run produced.
    // A step that fails ends the run failed, which the next round judges: its review may still
    // act on what the run produced. An error here is the scheduler's own, and stops the walk.
    drive_run(state, &queued.id, &pipeline, &plan, None, Some(deadline))
        .await
        .map_err(|e| ApiError::Internal(format!("run {}: {e}", queued.id.as_str())))?;
    Ok(WalkStatus::Walking)
}

async fn record_stop(
    state: &AppState,
    mut walk: Walk,
    round: usize,
    reason: WalkStopReason,
    detail: &str,
) -> Result<WalkStatus, ApiError> {
    let reviewed = match &walk.head_pipeline_version_id {
        Some(head) => json!({ "pipeline_version_id": head }),
        None => json!({}),
    };
    let step = step(
        state,
        walk.id.as_str(),
        round,
        WalkAction::Stop,
        detail,
        reviewed,
    )?;
    walk.status = WalkStatus::Stopped;
    walk.stop = Some(internal(parse(
        &json!({ "reason": reason, "detail": detail }).to_string(),
    ))?);
    walk.finished_at = Some(step.created_at.clone());
    state.store.record_walk_step(&walk, &step).await?;
    Ok(WalkStatus::Stopped)
}

/// A step of walk `walk_id` with the fields every step has and `extra`, checked through the
/// contract.
fn step(
    state: &AppState,
    walk_id: &str,
    round: usize,
    action: WalkAction,
    reason: &str,
    extra: Value,
) -> Result<WalkStep, ApiError> {
    let mut doc = json!({
        "schema_version": "sprisk.walk_step/v1", "walk_id": walk_id, "round": round,
        "action": action, "reason": reason, "created_at": format((state.clock)()),
    });
    if let (Some(doc), Value::Object(extra)) = (doc.as_object_mut(), extra) {
        doc.extend(extra);
    }
    internal(parse(&doc.to_string()))
}

fn internal<T>(parsed: Result<T, sprisk_contracts::ContractError>) -> Result<T, ApiError> {
    parsed.map_err(|e| ApiError::Internal(e.to_string()))
}

/// The most looks at a flow's folds, as the loop-back rule's settings state it.
fn max_looks(state: &AppState) -> Result<i64, ApiError> {
    state
        .rules
        .rules()
        .find(|r| r.decides.as_str() == LOOP_BACK)
        .and_then(|r| r.policy_thresholds.get("max_looks"))
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| ApiError::Internal(format!("no rule deciding {LOOP_BACK} states max_looks")))
}
