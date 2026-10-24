//! Walks (ADR-0060): the engine builds a flow from a question and its sources, then reviews,
//! applies and runs it through the same functions as the HTTP routes, until it must stop.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde_json::{Value, json};
use std::collections::BTreeMap;

use sprisk_contracts::{
    AppliedMethodologyDecision, AttemptState, CreateWalk, DecisionProposal, Method,
    MethodAssurance, MethodDecided, MethodDecidedOutcome, MethodologyDecision,
    MethodologyDecisionByRule, MethodologyReviewItem, Operator, PipelineVersion, PipelineVersionId,
    QuestionVersionId, Report, RunId, RunStatus, Walk, WalkAction, WalkAsk, WalkDetail, WalkId,
    WalkStatus, WalkStep, WalkStopReason, parse,
};
use sprisk_core::time::format;
use sprisk_methodology::deciding::{Effective, Made, Ready, apply_option, bindings, ready};
use sprisk_methodology::engine::{
    Action, HeadRun, MODEL_NODE, SCORE_BASELINE_NODE, SCORE_NODE, SHARES_NODE, Start, look_asks,
    next_action, start, with_test_scoring,
};
use sprisk_methodology::flow_decisions::last_verify;
use sprisk_methodology::measure::{Measuring, fitting, measure};
use sprisk_methodology::verifying::{Checking, Measured, checked, checking, fresh, sealed_by};
use sprisk_registry::evidence::EVIDENCE_PORT;

use crate::method_session::MethodSession;
use crate::report::{self, Scored};
use crate::{
    ApiError, AppState, Claimed, NOT_COMPARED, NOTHING_TO_COMPARE, Query, apply_methodology, body,
    check_local_paths, cite_decision, claim_selection, compile, decision_of, drive_run, id, limit,
    optional_id, propose, queued_run, review_methodology, run_plan,
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
    let defaults = sprisk_methodology::Defaults::of(&state.registry)?;
    let started = start(&question, &sources, &defaults).map_err(|e| ApiError::BadRequest {
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

/// What a completed walk found. A walk that has not completed has no report.
pub(crate) async fn get_walk_report(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> Result<Json<Report>, ApiError> {
    let walk_id: WalkId = id(&raw)?;
    Ok(Json(state.store.walk_report(&walk_id).await?))
}

/// A question's walks, newest first and paged (ADR-0064), so a person finds them again.
pub(crate) async fn list_walks(
    State(state): State<AppState>,
    query: Query,
) -> Result<Json<Vec<Walk>>, ApiError> {
    let question: Option<QuestionVersionId> = optional_id(&query, "question_version_id")?;
    let before: Option<WalkId> = optional_id(&query, "before")?;
    let walks = state
        .store
        .list_walks(question.as_ref(), before.as_ref(), limit(&query)?)
        .await?;
    Ok(Json(walks))
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

/// Takes up the walks a stopped server left walking, each from its stored head (ADR-0060),
/// in the background. Gives how many.
pub async fn resume_walks(state: &AppState) -> Result<usize, sprisk_store::StoreError> {
    let walking = state.store.walking_walks().await?;
    for walk_id in &walking {
        let (state, id) = (state.clone(), walk_id.clone());
        tokio::spawn(async move {
            match finish_left_run(&state, &id).await {
                Ok(()) => walk_on(&state, &id).await,
                Err(error) => stop_on_error(&state, &id, error).await,
            }
        });
    }
    Ok(walking.len())
}

/// Drives to its end the run the walk's last step names, when the server stopped while it ran:
/// a round never judges a run still going, and a new run for the same round would be a second.
async fn finish_left_run(state: &AppState, walk_id: &WalkId) -> Result<(), ApiError> {
    let walk = state.store.get_walk(walk_id).await?;
    let steps = state.store.walk_steps(walk_id).await?;
    let Some(run_id) = steps
        .last()
        .filter(|s| {
            matches!(
                s.action,
                WalkAction::Run | WalkAction::Compare | WalkAction::Score
            )
        })
        .and_then(|s| s.run_id.clone())
    else {
        return Ok(());
    };
    let run = state.store.get_run(&run_id).await?;
    if !matches!(run.status, RunStatus::Queued | RunStatus::Running) {
        return Ok(());
    }
    let pipeline = state
        .store
        .get_pipeline_version(&run.pipeline_version_id)
        .await?;
    // The same checks as its first start: data roots, and key columns left out (ADR-0056).
    let plan = run_plan(state, &pipeline).await?;
    drive_run(
        state,
        &run_id,
        &pipeline,
        &plan,
        None,
        Some(deadline(&walk)?),
    )
    .await
    .map_err(|e| ApiError::Internal(format!("run {}: {e}", run_id.as_str())))?;
    Ok(())
}

/// Takes rounds until the walk stops. An error stops it too, with the error as its detail,
/// so a walk never stays `walking` with nothing driving it.
async fn walk_on(state: &AppState, walk_id: &WalkId) {
    loop {
        match round(state, walk_id).await {
            Ok(WalkStatus::Walking) => continue,
            Ok(WalkStatus::Stopped) => return,
            Err(error) => return stop_on_error(state, walk_id, error).await,
        }
    }
}

async fn stop_on_error(state: &AppState, walk_id: &WalkId, error: ApiError) {
    // Another server took this round first and drives the walk: it is not this one's to stop.
    if matches!(
        error,
        ApiError::Store(sprisk_store::StoreError::Conflict(_))
    ) {
        tracing::warn!(walk = walk_id.as_str(), error = %error, "another driver took the round");
        return;
    }
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
}

/// One round: check the budget and the head, review the head, then apply, run or stop.
async fn round(state: &AppState, walk_id: &WalkId) -> Result<WalkStatus, ApiError> {
    let walk = state.store.get_walk(walk_id).await?;
    if walk.status == WalkStatus::Stopped {
        return Ok(WalkStatus::Stopped);
    }
    let steps = state.store.walk_steps(walk_id).await?;
    let round = steps.len();
    // The test rows were scored: the walk ends on that score, and never acts after it.
    if let Some(scored) = steps.last().filter(|s| s.action == WalkAction::Score) {
        return finish_scoring(state, walk, round, scored).await;
    }
    let head = walk.head_pipeline_version_id.clone().ok_or_else(|| {
        ApiError::Internal(format!("walk {} is walking with no head", walk_id.as_str()))
    })?;
    let acted = steps
        .iter()
        .filter(|s| {
            matches!(
                s.action,
                WalkAction::Apply
                    | WalkAction::Run
                    | WalkAction::Compare
                    | WalkAction::Measure
                    | WalkAction::Decide
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
        // The apply of this round may have been saved before its step, as a server stopped.
        if let Some(decision) = state
            .store
            .methodology_decision_by_key(&apply_key(&walk, round))
            .await?
        {
            let decision = match decision {
                MethodologyDecision::Rule(decision) => decision,
                method => return record_decided(state, walk, round, &method).await,
            };
            let proposal = state
                .store
                .get_methodology_proposal(&decision.proposal_id)
                .await?;
            let why = proposal
                .alternatives
                .iter()
                .find(|a| a.id.as_str() == decision.alternative_id.as_str())
                .map_or("", |a| a.reason.as_str());
            let reason = format!("{why} (applied before a restart)");
            return record_apply(state, walk, round, &decision, reason.trim_start()).await;
        }
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
    // The look (ADR-0063 amendment): until a rule acts, the walk measures, runs the first flow
    // once and lets the methods decide, so every question is asked at the start, in one list.
    let looking = !steps.iter().any(|s| {
        matches!(
            s.action,
            WalkAction::Apply | WalkAction::Compare | WalkAction::Score
        )
    });
    let pipeline = state.store.get_pipeline_version(&head).await?;
    let operators: Vec<Operator> = state.registry.operators().cloned().collect();
    let made = made(&steps)?;
    let effective = bindings(&question, &made).map_err(resolve_error)?;
    let mut notes = Vec::new();
    // Producers are put in place before a run or a stop, and moved back onto their rows when a
    // step was added in front of where they attach.
    if looking || matches!(action, Action::Run { .. } | Action::Stop { .. }) {
        let measuring = measure(
            &state.rules,
            &pipeline,
            &question,
            &effective.bindings,
            &operators,
            &made,
        )
        .map_err(resolve_error)?;
        if !measuring.effects.is_empty() {
            return record_measure(state, walk, round, &pipeline, measuring).await;
        }
        let kinds = produced_kinds(state, &pipeline);
        if head_run == HeadRun::NotRun
            && (looking || (!kinds.is_empty() && matches!(action, Action::Stop { .. })))
        {
            let reason = if looking {
                "The look: runs the first flow once, before any rule acts, so every question is \
                 found at the start."
                    .to_owned()
            } else {
                format!("Runs the flow to measure {}.", kinds.join(", "))
            };
            return run(state, walk, round, &head, deadline, &reason).await;
        }
        notes = measuring.left_out;
    }
    let measured = evidence(state, &steps, &head, &pipeline).await?;
    let fields: BTreeMap<String, Value> = measured
        .iter()
        .map(|(kind, (_, found))| (kind.clone(), found.clone()))
        .collect();
    let promised = checking(&state.rules, &made, &measured).map_err(resolve_error)?;
    let holding = holding_checks(state, &steps, &pipeline, &promised).await?;
    let mut session = state.method_runner.session();
    // A run that failed after the split still measured what the split wrote.
    if head_run != HeadRun::NotRun && !promised.is_empty() && holding.is_none() {
        return record_verify(
            state,
            walk,
            round,
            &steps,
            &pipeline,
            &promised,
            &mut session,
        )
        .await;
    }
    let readiness = ready(
        &state.rules,
        &question,
        &made,
        &effective,
        &fields,
        &operators,
    )
    .map_err(resolve_error)?;
    let mut asks = readiness.asks;
    let read = Read {
        head: &pipeline,
        effective: &effective,
        operators: &operators,
        measured: &fields,
    };
    // A method that asks is asked again each round until a person answers: the one list is
    // built from the methods' current asks, never from a stored copy.
    for Ready { method, request } in readiness.ready {
        // A person's answer is taken whatever the method would choose (ADR-0063 amendment).
        if let Some(answer) = question
            .answers
            .iter()
            .find(|a| a.decides == method.decides)
        {
            let label = method
                .options
                .iter()
                .find(|o| o.id == answer.option)
                .map_or(answer.option.as_str(), |o| o.label.as_str());
            let taking = Taking {
                method,
                option: answer.option.to_string(),
                assurance: MethodAssurance::Confirmed,
                reason: format!("A person answered: {label}."),
            };
            return record_decide(state, walk, round, &read, taking).await;
        }
        let decided = session
            .decide(&request)
            .await
            .map_err(|e| ApiError::Internal(format!("method {}: {e}", method.id.as_str())))?;
        if decided.outcome == MethodDecidedOutcome::Ask {
            asks.push(method_ask(method, &decided)?);
            continue;
        }
        let taking = Taking {
            method,
            option: decided.option.to_string(),
            assurance: MethodAssurance::Rule,
            reason: decided.reason.to_string(),
        };
        return record_decide(state, walk, round, &read, taking).await;
    }
    if looking {
        asks.extend(look_asks(&review, &question, &state.rules).map_err(resolve_error)?);
    }
    if !asks.is_empty() {
        let lead = if looking {
            "Answer these before the walk goes on:"
        } else {
            "A question came up after the look, which should have found it:"
        };
        let listed: Vec<String> = asks
            .iter()
            .map(|a| format!("{}: {}", a.decides.as_str(), a.question.as_str()))
            .collect();
        let detail = format!("{lead} {}", listed.join(" "));
        return record_stop_with(
            state,
            walk,
            round,
            WalkStopReason::NeedsPerson,
            &detail,
            &asks,
        )
        .await;
    }
    let noted = |detail: String| {
        [detail]
            .into_iter()
            .chain(notes.clone())
            .collect::<Vec<_>>()
            .join(" ")
    };
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
                proposal: &proposal,
                alternative,
                reason: item.reason.as_str(),
            };
            apply(state, walk, round, applying).await
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
            let detail = noted(format!("{failed} Still open: {detail}"));
            record_stop(state, walk, round, WalkStopReason::RunFailed, &detail).await
        }
        Action::Stop {
            reason: WalkStopReason::Complete,
            detail,
        } => {
            let undecided: Vec<String> = fitting(&state.rules, question.task.value)
                .filter(|m| !made.iter().any(|d| d.decides == m.decides.as_str()))
                .map(|m| format!("{}: {}", m.decides.as_str(), m.question.as_str()))
                .collect();
            if !undecided.is_empty() {
                let detail = noted(format!(
                    "Every rule is settled, but these methods have not decided: {}",
                    undecided.join(" ")
                ));
                return record_stop(state, walk, round, WalkStopReason::Uncovered, &detail).await;
            }
            if !promised.is_empty() {
                let checks = holding.map(|verified| verified.verifications.as_slice());
                if let Some(held) = sealed_by(checks) {
                    let detail = noted(format!("{detail} {held}"));
                    return record_stop(state, walk, round, WalkStopReason::Unverified, &detail)
                        .await;
                }
            }
            score_test_rows(state, walk, round, &head, deadline, &detail).await
        }
        Action::Stop { reason, detail } => {
            record_stop(state, walk, round, reason, &noted(detail)).await
        }
    }
}

/// Stores the version with the producers placed, and the measure step that made it, and
/// moves the walk's head to it.
async fn record_measure(
    state: &AppState,
    mut walk: Walk,
    round: usize,
    head: &PipelineVersion,
    measuring: Measuring,
) -> Result<WalkStatus, ApiError> {
    let (nodes, edges) =
        sprisk_methodology::patch::apply(head, &measuring.effects, |o| state.registry.get(o))
            .map_err(|e| ApiError::Internal(e.to_string()))?;
    let made: PipelineVersion = internal(parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": format!("plv_{}", ulid::Ulid::new()),
            "project_id": head.project_id, "parent_id": head.id,
            "question_version_id": head.question_version_id,
            "nodes": nodes, "edges": edges,
            "created_at": format((state.clock)()),
        })
        .to_string(),
    ))?;
    compile(&made, &state.registry).map_err(ApiError::Compile)?;
    let ids = json!({ "pipeline_version_id": head.id, "made_pipeline_version_id": made.id,
                      "effects": measuring.effects });
    let reason = measuring.changes.join(" ");
    let step = step(
        state,
        walk.id.as_str(),
        round,
        WalkAction::Measure,
        &reason,
        ids,
    )?;
    walk.head_pipeline_version_id = Some(made.id.clone());
    state.store.record_walk_version(&walk, &step, &made).await?;
    Ok(WalkStatus::Walking)
}

/// The evidence kinds the steps of `pipeline` produce.
fn produced_kinds(state: &AppState, pipeline: &PipelineVersion) -> Vec<String> {
    pipeline
        .nodes
        .iter()
        .filter_map(|n| state.registry.get(n.operator.as_str()))
        .flat_map(|op| op.produces.keys().map(|k| k.to_string()))
        .collect()
}

/// What the producers of `head` measured in the walk's run of it, by evidence kind, with the
/// step that measured it. Empty when the walk has not run it.
async fn evidence(
    state: &AppState,
    steps: &[WalkStep],
    head: &PipelineVersionId,
    pipeline: &PipelineVersion,
) -> Result<Measured, ApiError> {
    let mut found = BTreeMap::new();
    let Some(run_id) = head_run_id(steps, head) else {
        return Ok(found);
    };
    let attempts = state.store.list_attempts(&run_id).await?;
    for node in &pipeline.nodes {
        let Some(operator) = state.registry.get(node.operator.as_str()) else {
            continue;
        };
        if operator.produces.is_empty() {
            continue;
        }
        // A run that failed before this step measured nothing here.
        let Some(attempt) = attempts.iter().find(|a| {
            a.node_id == node.id
                && matches!(a.state, AttemptState::Succeeded | AttemptState::CacheHit)
        }) else {
            continue;
        };
        let (_, artifact) = state
            .store
            .outputs(&attempt.id)
            .await?
            .into_iter()
            .find(|(port, _)| port == EVIDENCE_PORT)
            .ok_or_else(|| {
                ApiError::Internal(format!("step {} wrote no evidence", node.id.as_str()))
            })?;
        let bytes = state.artifacts.get(artifact.content_hash.as_str()).await?;
        // Checked against the producer's manifest when its outputs were saved.
        let set: BTreeMap<String, Value> = serde_json::from_slice(&bytes).map_err(|e| {
            ApiError::Internal(format!("evidence of step {}: {e}", node.id.as_str()))
        })?;
        found.extend(
            set.into_iter()
                .map(|(kind, fields)| (kind, (node.id.to_string(), fields))),
        );
    }
    Ok(found)
}

/// The decisions the walk's decide steps made, in order. A decide step always names its
/// decision and option; one that does not is a broken record, never skipped.
fn made(steps: &[WalkStep]) -> Result<Vec<Made>, ApiError> {
    steps
        .iter()
        .filter(|s| s.action == WalkAction::Decide)
        .map(|s| match (&s.decides, &s.option) {
            (Some(decides), Some(option)) => Ok(Made {
                decides: decides.to_string(),
                option: option.to_string(),
                bindings: s.bindings.clone(),
            }),
            _ => Err(ApiError::Internal(format!(
                "decide step {} of walk {} names no decision or option",
                s.round,
                s.walk_id.as_str()
            ))),
        })
        .collect()
}

/// A method's ask, with every option for a person to pick from.
fn method_ask(method: &Method, decided: &MethodDecided) -> Result<WalkAsk, ApiError> {
    let options: Vec<Value> = method
        .options
        .iter()
        .map(|o| json!({ "id": o.id, "label": o.label }))
        .collect();
    internal(parse(
        &json!({
            "decides": method.decides, "question": decided.reason, "method": method.id,
            "option": decided.option, "options": options,
        })
        .to_string(),
    ))
}

/// The option a decide step takes, how, and why.
struct Taking<'m> {
    method: &'m Method,
    option: String,
    assurance: MethodAssurance,
    reason: String,
}

/// What a round read before a method decides: the head, the bindings in force, the
/// registered operators and what the head's run measured, by evidence kind.
struct Read<'r> {
    head: &'r PipelineVersion,
    effective: &'r Effective,
    operators: &'r [Operator],
    measured: &'r BTreeMap<String, Value>,
}

/// Takes `taking`'s option through the same Apply as a rule's (ADR-0064): keyed by the walk
/// and round, refused when the head changed under the round, and cited by every step it
/// changed. A patch is stored as a new version the walk's head moves to.
async fn record_decide(
    state: &AppState,
    walk: Walk,
    round: usize,
    read: &Read<'_>,
    taking: Taking<'_>,
) -> Result<WalkStatus, ApiError> {
    let head = read.head;
    let applied = apply_option(
        taking.method,
        &taking.option,
        taking.assurance,
        &read.effective.bindings,
        head,
        read.operators,
        read.measured,
    )
    .map_err(resolve_error)?;
    let decision_id = format!("mdc_{}", ulid::Ulid::new());
    let at = format((state.clock)());
    let mut decision = json!({
        "schema_version": "sprisk.methodology_decision/v1", "id": decision_id,
        "method": taking.method.id, "decides": taking.method.decides, "option": taking.option,
        "assurance": taking.assurance, "reason": taking.reason,
        "question_version_id": head.question_version_id, "base_pipeline_version_id": head.id,
        "created_at": at,
    });
    if !applied.bindings.is_empty() {
        decision["bindings"] = json!(applied.bindings);
    }
    if !applied.promises.is_empty() {
        decision["promises"] = json!(applied.promises);
    }
    let made = if applied.effects.is_empty() {
        None
    } else {
        let (mut nodes, edges) =
            sprisk_methodology::patch::apply(head, &applied.effects, |o| state.registry.get(o))
                .map_err(resolve_error)?;
        for effect in &applied.effects {
            cite_decision(&mut nodes, effect, &decision_id)?;
        }
        let made: PipelineVersion = internal(parse(
            &json!({
                "schema_version": "sprisk.pipeline_version/v1",
                "id": format!("plv_{}", ulid::Ulid::new()),
                "project_id": head.project_id, "parent_id": head.id,
                "question_version_id": head.question_version_id,
                "nodes": nodes, "edges": edges, "created_at": at,
            })
            .to_string(),
        ))?;
        compile(&made, &state.registry).map_err(ApiError::Compile)?;
        decision["effects"] = json!(applied.effects);
        decision["pipeline_version_id"] = json!(made.id);
        Some(made)
    };
    let decision: MethodologyDecision = internal(parse(&decision.to_string()))?;
    let key = apply_key(&walk, round);
    let saved = match state.store.methodology_decision_by_key(&key).await? {
        Some(saved) => {
            sprisk_store::same_request(&saved, &key, &decision)?;
            saved
        }
        None if state.store.has_pipeline_child(&head.id).await? => {
            let detail = format!(
                "Version {} gained a version while the walk decided {}.",
                head.id.as_str(),
                taking.method.decides.as_str()
            );
            return record_stop(state, walk, round, WalkStopReason::Stale, &detail).await;
        }
        None => {
            state
                .store
                .apply_methodology_decision(&decision, made.as_ref(), &key)
                .await?
        }
    };
    record_decided(state, walk, round, &saved).await
}

/// Records the decide step of a method's decision and moves the walk's head to the version it
/// made, if any.
async fn record_decided(
    state: &AppState,
    mut walk: Walk,
    round: usize,
    decision: &MethodologyDecision,
) -> Result<WalkStatus, ApiError> {
    let MethodologyDecision::Method(decision) = decision else {
        return Err(ApiError::Internal(format!(
            "walk {} round {round}: decision {} is a rule's, not a method's",
            walk.id.as_str(),
            decision.id().as_str()
        )));
    };
    let mut made = json!({
        "pipeline_version_id": decision.base_pipeline_version_id, "decides": decision.decides,
        "method": decision.method, "option": decision.option, "assurance": decision.assurance,
        "methodology_decision_id": decision.id,
    });
    for (field, value) in [
        ("bindings", json!(decision.bindings)),
        ("promises", json!(decision.promises)),
        ("effects", json!(decision.effects)),
    ] {
        if value.as_array().is_some_and(|a| !a.is_empty()) {
            made[field] = value;
        }
    }
    if let Some(version) = &decision.pipeline_version_id {
        made["made_pipeline_version_id"] = json!(version);
        walk.head_pipeline_version_id = Some(version.clone());
    }
    let step = step(
        state,
        walk.id.as_str(),
        round,
        WalkAction::Decide,
        decision.reason.as_str(),
        made,
    )?;
    state.store.record_walk_step(&walk, &step).await?;
    Ok(WalkStatus::Walking)
}

/// The walk's last verify step, when it checked the promises in `promised` and each check
/// still holds for `head`: nothing before the evidence it read changed.
async fn holding_checks<'s>(
    state: &AppState,
    steps: &'s [WalkStep],
    head: &PipelineVersion,
    promised: &[Checking<'_>],
) -> Result<Option<&'s WalkStep>, ApiError> {
    let Some(last) = last_verify(steps) else {
        return Ok(None);
    };
    let checked: Vec<(&str, &str)> = last
        .verifications
        .iter()
        .map(|c| (c.decides.as_str(), c.verification.as_str()))
        .collect();
    let promises: Vec<(&str, &str)> = promised
        .iter()
        .map(|c| (c.promise.method.decides.as_str(), c.promise.name.as_str()))
        .collect();
    if checked != promises {
        return Ok(None);
    }
    let on = last.pipeline_version_id.as_ref().ok_or_else(|| {
        ApiError::Internal(format!("verify step {} names no version", last.round))
    })?;
    let verified = state.store.get_pipeline_version(on).await?;
    let holds = last.verifications.iter().all(|c| fresh(&verified, head, c));
    Ok(holds.then_some(last))
}

/// Checks each promise on the evidence the head's run measured, and records what each check
/// found as a verify step.
async fn record_verify(
    state: &AppState,
    walk: Walk,
    round: usize,
    steps: &[WalkStep],
    head: &PipelineVersion,
    promised: &[Checking<'_>],
    session: &mut MethodSession,
) -> Result<WalkStatus, ApiError> {
    let mut checks = Vec::new();
    for promise in promised {
        let Some((_, request)) = &promise.request else {
            checks.push(promise.not_evaluated().map_err(resolve_error)?);
            continue;
        };
        let verified = session.verify(request).await.map_err(|e| {
            ApiError::Internal(format!(
                "method {}: {e}",
                promise.promise.method.id.as_str()
            ))
        })?;
        checks.push(checked(promise, &verified).map_err(resolve_error)?);
    }
    let made = json!({ "pipeline_version_id": head.id,
                       "run_id": head_run_id(steps, &head.id), "verifications": checks });
    let reason = "Checks what the decisions promise, on the evidence this run measured.";
    let step = step(
        state,
        walk.id.as_str(),
        round,
        WalkAction::Verify,
        reason,
        made,
    )?;
    state.store.record_walk_step(&walk, &step).await?;
    Ok(WalkStatus::Walking)
}

fn resolve_error(error: sprisk_methodology::ResolveError) -> ApiError {
    match error {
        sprisk_methodology::ResolveError::Rules(rules) => ApiError::Rules(rules),
        other => ApiError::Internal(other.to_string()),
    }
}

/// Every rule is settled: the model is scored on the test rows, once (ADR-0060). A version
/// with one Evaluate added is stored with its run and step, and run; the next round reads the
/// score and ends the walk. No rule reads it.
async fn score_test_rows(
    state: &AppState,
    walk: Walk,
    round: usize,
    head: &PipelineVersionId,
    deadline: jiff::Timestamp,
    settled: &str,
) -> Result<WalkStatus, ApiError> {
    let pipeline = state.store.get_pipeline_version(head).await?;
    // A baseline has no family: nothing was chosen, so the test rows stay sealed.
    let chosen = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == MODEL_NODE)
        .and_then(|n| state.registry.get(n.operator.as_str()))
        .and_then(|o| o.model.as_ref())
        .is_some_and(|m| m.family.is_some());
    if !chosen {
        let detail = format!(
            "{settled} The model step is still the baseline: no model was chosen, so the test \
             rows stay sealed."
        );
        return record_stop(state, walk, round, WalkStopReason::Limitation, &detail).await;
    }
    let defaults = sprisk_methodology::Defaults::of(&state.registry)?;
    let (nodes, edges) = with_test_scoring(&pipeline, &defaults).map_err(|e| {
        ApiError::Internal(format!("scoring the test rows of {}: {e}", head.as_str()))
    })?;
    let scored: PipelineVersion = internal(parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": format!("plv_{}", ulid::Ulid::new()),
            "project_id": pipeline.project_id, "parent_id": head,
            "question_version_id": pipeline.question_version_id,
            "nodes": nodes, "edges": edges, "created_at": format((state.clock)()),
        })
        .to_string(),
    ))?;
    let (queued, plan) = queued_run(state, &scored).await?;
    let made = json!({
        "pipeline_version_id": head, "made_pipeline_version_id": scored.id, "run_id": queued.id,
    });
    let reason = format!("{settled} The model is scored on the test rows, once.");
    let step = step(
        state,
        walk.id.as_str(),
        round,
        WalkAction::Score,
        &reason,
        made,
    )?;
    let mut scoring = walk.clone();
    scoring.head_pipeline_version_id = Some(scored.id.clone());
    // A walk saved before sources were hashed cannot say which rows it spends.
    if walk.source_hashes.is_empty() {
        state
            .store
            .record_walk_run(&scoring, &step, &queued, Some(&scored))
            .await?;
    } else if let Some(earlier) = state
        .store
        .record_walk_score(&scoring, &step, &queued, &scored)
        .await?
    {
        let detail = spent_detail(state, &earlier, settled).await?;
        return record_stop(state, walk, round, WalkStopReason::Limitation, &detail).await;
    }
    drive_run(state, &queued.id, &scored, &plan, None, Some(deadline))
        .await
        .map_err(|e| ApiError::Internal(format!("run {}: {e}", queued.id.as_str())))?;
    Ok(WalkStatus::Walking)
}

/// Why a walk whose test rows were already scored stops: a second score would be a second
/// look at them, and choosing after it would choose by them.
async fn spent_detail(
    state: &AppState,
    earlier: &WalkId,
    settled: &str,
) -> Result<String, ApiError> {
    let walk = state.store.get_walk(earlier).await?;
    // A scoring run that failed may still have read the test rows: they stay spent.
    let (did, ended) = match &walk.stop {
        Some(stop) if stop.reason == WalkStopReason::Complete => {
            ("scored", format!(" It ended: {}", stop.detail.as_str()))
        }
        Some(stop) => (
            "began scoring",
            format!(" It ended: {}", stop.detail.as_str()),
        ),
        None => ("is scoring", String::new()),
    };
    Ok(format!(
        "{settled} Walk {} {did} the test rows of a file this walk reads, so they are not \
         scored again: a flow changed after that score would be chosen by it. To check a \
         changed flow, score it on new rows from another file.{ended}",
        earlier.as_str()
    ))
}

/// Ends the walk on the score of its test rows: complete with the scores, or why not.
async fn finish_scoring(
    state: &AppState,
    walk: Walk,
    round: usize,
    scored: &WalkStep,
) -> Result<WalkStatus, ApiError> {
    let run_id = scored
        .run_id
        .clone()
        .ok_or_else(|| ApiError::Internal("the score step names no run".into()))?;
    match state.store.get_run(&run_id).await?.status {
        RunStatus::Succeeded => {}
        RunStatus::Cancelled => {
            let detail = format!(
                "The walk used its {} seconds while it scored the test rows.",
                walk.max_wall_seconds
            );
            return record_stop(state, walk, round, WalkStopReason::BudgetExhausted, &detail).await;
        }
        _ => {
            let failed = failed_attempts(state, &run_id).await?;
            let detail = format!("Scoring the test rows failed. {failed}");
            return record_stop(state, walk, round, WalkStopReason::RunFailed, &detail).await;
        }
    }
    let metrics = run_metrics(state, &run_id, SCORE_NODE).await?;
    let floor = scores(&run_metrics(state, &run_id, SCORE_BASELINE_NODE).await?);
    if floor.is_empty() {
        return Err(ApiError::Internal(format!(
            "run {} reports no baseline score",
            run_id.as_str()
        )));
    }
    let question = state
        .store
        .get_question_version(&walk.question_version_id)
        .await?;
    let n_rows = metrics["n_rows"]
        .as_u64()
        .ok_or_else(|| ApiError::Internal(format!("run {} gives no row count", run_id.as_str())))?;
    let reported = scores(&metrics);
    if reported.is_empty() {
        return Err(ApiError::Internal(format!(
            "run {} reports no score",
            run_id.as_str()
        )));
    }
    let bar = question
        .success_bar
        .as_ref()
        .map(|bar| {
            against_bar(
                &metrics,
                bar.value.metric.to_string().as_str(),
                bar.value.score,
            )
        })
        .unwrap_or_default();
    let answer = format!(
        "Test rows, scored once ({n_rows} rows): {bar}{reported}; the baseline on the same rows: {floor}."
    );
    let detail = format!("Every rule that fits the question is settled. {answer}");
    let flow = scored.made_pipeline_version_id.as_ref().ok_or_else(|| {
        ApiError::Internal(format!(
            "the score step of walk {} names no flow",
            walk.id.as_str()
        ))
    })?;
    let steps = state.store.walk_steps(&walk.id).await?;
    // A classifier's score compares the class shares of its train and test rows.
    let scored_flow = state.store.get_pipeline_version(flow).await?;
    let shares = if scored_flow
        .nodes
        .iter()
        .any(|n| n.id.as_str() == SHARES_NODE)
    {
        Some(run_metrics(state, &run_id, SHARES_NODE).await?)
    } else {
        None
    };
    let records = Scored {
        shares: shares.as_ref(),
        walk: &walk.id,
        question: &question,
        steps: &steps,
        answer: &answer,
        run: &run_id,
        flow,
    };
    let report = report::build(
        &records,
        &format!("rpt_{}", ulid::Ulid::new()),
        &format((state.clock)()),
    )
    .map_err(|e| ApiError::Internal(format!("the report of walk {}: {e}", walk.id.as_str())))?;
    let (walk, step) = stopping(state, walk, round, WalkStopReason::Complete, &detail, &[])?;
    state
        .store
        .record_walk_report(&walk, &step, &report)
        .await?;
    Ok(WalkStatus::Stopped)
}

/// The metrics the score step of `run_id` wrote: its own run's, never another run's.
async fn run_metrics(state: &AppState, run_id: &RunId, node: &str) -> Result<Value, ApiError> {
    let attempt = state
        .store
        .list_attempts(run_id)
        .await?
        .into_iter()
        // A step identical to one already run takes its outputs from the cache: a flow whose
        // model is itself the baseline, as a restarted walk's test sets up, scores it twice.
        .find(|a| {
            a.node_id.as_str() == node
                && matches!(a.state, AttemptState::Succeeded | AttemptState::CacheHit)
        })
        .ok_or_else(|| {
            ApiError::Internal(format!("run {} scored nothing at {node}", run_id.as_str()))
        })?;
    let (_, artifact) = state
        .store
        .outputs(&attempt.id)
        .await?
        .into_iter()
        .find(|(port, _)| port == "metrics")
        .ok_or_else(|| {
            ApiError::Internal(format!(
                "run {} wrote no metrics at {node}",
                run_id.as_str()
            ))
        })?;
    let bytes = state.artifacts.get(artifact.content_hash.as_str()).await?;
    serde_json::from_slice(&bytes).map_err(|e| {
        ApiError::Internal(format!("metrics of {node} in run {}: {e}", run_id.as_str()))
    })
}

/// The success bar's metric on the test rows, and whether it reaches the bar. Lower is better
/// for a cost or an error.
fn against_bar(metrics: &Value, metric: &str, bar: f64) -> String {
    let Some(score) = metrics.get(metric).and_then(Value::as_f64) else {
        return format!("the success bar's {metric} was not reported; ");
    };
    let met = if matches!(metric, "expected_cost" | "rmse") {
        score <= bar
    } else {
        score >= bar
    };
    let verdict = if met { "meets" } else { "misses" };
    format!("{metric} {score:.3} {verdict} the success bar of {bar}; ")
}

/// The scores Evaluate reports, as a person reads them.
fn scores(metrics: &Value) -> String {
    [
        ("weighted_f1", "weighted F1"),
        ("balanced_accuracy", "balanced accuracy"),
        ("accuracy", "accuracy"),
        ("expected_cost", "expected cost"),
        ("rmse", "RMSE"),
        ("mae", "MAE"),
        ("r2", "R²"),
    ]
    .iter()
    .filter_map(|(key, label)| Some(format!("{label} {:.3}", metrics.get(key)?.as_f64()?)))
    .collect::<Vec<_>>()
    .join(", ")
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
        proposal: &selection.proposal,
        alternative: winner.as_str(),
        reason: decision.reason.as_str(),
    };
    apply(state, walk, round, applying).await
}

/// Applies `alternative` to step `subject` through the same Apply as a person, keyed by the
/// walk and round, so a repeated round gets the saved decision.
async fn apply(
    state: &AppState,
    walk: Walk,
    round: usize,
    Applying {
        proposal,
        alternative,
        reason,
    }: Applying<'_>,
) -> Result<WalkStatus, ApiError> {
    let choice = json!({
        "alternative_id": alternative,
        "idempotency_key": apply_key(&walk, round),
    });
    let applied = apply_methodology(
        State(state.clone()),
        Path(proposal.id.to_string()),
        choice.to_string(),
    )
    .await;
    let decision = match applied {
        Ok((_, Json(AppliedMethodologyDecision { decision, .. }))) => match decision {
            MethodologyDecision::Rule(decision) => decision,
            MethodologyDecision::Method(method) => {
                return Err(ApiError::Internal(format!(
                    "the apply key of walk {} round {round} names method decision {}",
                    walk.id.as_str(),
                    method.id.as_str()
                )));
            }
        },
        // Someone changed the head while this round reviewed it.
        Err(ApiError::BadRequest {
            code: "stale_proposal",
            message,
        }) => {
            return record_stop(state, walk, round, WalkStopReason::Stale, &message).await;
        }
        Err(other) => return Err(other),
    };
    record_apply(state, walk, round, &decision, reason).await
}

/// The key of the apply a walk takes in `round`: a replayed apply returns the saved decision.
fn apply_key(walk: &Walk, round: usize) -> String {
    format!("{}-round-{round}", walk.id.as_str())
}

/// Records the apply step of `decision` and moves the walk's head to the version it made.
async fn record_apply(
    state: &AppState,
    mut walk: Walk,
    round: usize,
    decision: &MethodologyDecisionByRule,
    reason: &str,
) -> Result<WalkStatus, ApiError> {
    let decides = state
        .rules
        .rule(decision.rule.as_str())
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .decides
        .clone();
    let made = json!({
        "pipeline_version_id": decision.base_pipeline_version_id, "rule": decision.rule,
        "decides": decides, "subject_node_id": decision.subject_node_id,
        "alternative_id": decision.alternative_id, "methodology_decision_id": decision.id,
        "made_pipeline_version_id": decision.pipeline_version_id,
    });
    let step = step(
        state,
        walk.id.as_str(),
        round,
        WalkAction::Apply,
        reason,
        made,
    )?;
    walk.head_pipeline_version_id = Some(decision.pipeline_version_id.clone());
    state.store.record_walk_step(&walk, &step).await?;
    Ok(WalkStatus::Walking)
}

/// Runs the head to its end, or to the walk's deadline. The run and its step are stored
/// together before the run is driven, so a server that stops during it resumes that run.
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
    let ran = json!({ "pipeline_version_id": head, "run_id": queued.id });
    let step = step(state, walk.id.as_str(), round, WalkAction::Run, reason, ran)?;
    state
        .store
        .record_walk_run(&walk, &step, &queued, None)
        .await?;
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
    walk: Walk,
    round: usize,
    reason: WalkStopReason,
    detail: &str,
) -> Result<WalkStatus, ApiError> {
    record_stop_with(state, walk, round, reason, detail, &[]).await
}

/// Ends the walk, with `asks` on its stop when there are any.
async fn record_stop_with(
    state: &AppState,
    walk: Walk,
    round: usize,
    reason: WalkStopReason,
    detail: &str,
    asks: &[WalkAsk],
) -> Result<WalkStatus, ApiError> {
    let (walk, step) = stopping(state, walk, round, reason, detail, asks)?;
    state.store.record_walk_step(&walk, &step).await?;
    Ok(WalkStatus::Stopped)
}

/// The walk as it stands once stopped, and its stop step; nothing is stored yet.
fn stopping(
    state: &AppState,
    mut walk: Walk,
    round: usize,
    reason: WalkStopReason,
    detail: &str,
    asks: &[WalkAsk],
) -> Result<(Walk, WalkStep), ApiError> {
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
    let mut stop = json!({ "reason": reason, "detail": detail });
    if !asks.is_empty() {
        stop["asks"] = json!(asks);
    }
    walk.stop = Some(internal(parse(&stop.to_string()))?);
    walk.finished_at = Some(step.created_at.clone());
    Ok((walk, step))
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
