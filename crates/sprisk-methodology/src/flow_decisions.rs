//! What decided a flow version, for people (ADR-0063 slice 5): the decisions a walk made, the
//! steps each shaped, and whether each promise still holds on the version asked about. Pure:
//! the API finds the walk and its versions.

use serde_json::json;
use sprisk_contracts::{
    FlowDecisions, GraphEffect, PipelineVersion, PromiseCheck, PromiseResult, WalkAction, WalkId,
    WalkStep, parse,
};

use crate::deciding::made_by;
use crate::verifying::fresh;
use crate::{ResolveError, RuleCatalog};

/// The walk's steps while the version made at round `made_at` was its head: up to the next
/// step that made another version.
pub fn while_head(steps: &[WalkStep], made_at: usize) -> &[WalkStep] {
    let until = steps
        .iter()
        .position(|s| s.round > made_at as u64 && s.made_pipeline_version_id.is_some())
        .unwrap_or(steps.len());
    &steps[..until]
}

/// The last verify step in `steps`.
pub fn last_verify(steps: &[WalkStep]) -> Option<&WalkStep> {
    steps.iter().rev().find(|s| s.action == WalkAction::Verify)
}

/// The decisions in `steps`, the steps `while_head` gives for `asked` or its nearest ancestor,
/// with each promise's standing on `asked`. `verified` is the version the last verify step in
/// `steps` checked; None when there is none.
pub fn flow_decisions(
    catalog: &RuleCatalog,
    walk_id: &WalkId,
    steps: &[WalkStep],
    asked: &PipelineVersion,
    verified: Option<&PipelineVersion>,
) -> Result<FlowDecisions, ResolveError> {
    let last_checks: &[PromiseCheck] =
        last_verify(steps).map_or(&[], |s| s.verifications.as_slice());
    let in_force = made_by(catalog, steps)?;
    let mut decisions = Vec::new();
    for decided in steps.iter().filter(|s| s.action == WalkAction::Decide) {
        // A decision made again shows once, as it is now; one dropped since is not shown.
        if !in_force.iter().any(|m| m.round == decided.round) {
            continue;
        }
        let (Some(method_id), Some(decides), Some(option)) =
            (&decided.method, &decided.decides, &decided.option)
        else {
            return Err(ResolveError::NotInsertable(format!(
                "decide step {} names no method, decision or option",
                decided.round
            )));
        };
        let method = catalog
            .methods()
            .find(|m| m.id == *method_id)
            .ok_or_else(|| ResolveError::UnknownMethod(method_id.to_string()))?;
        let label = method
            .options
            .iter()
            .find(|o| o.id == *option)
            .map(|o| o.label.to_string())
            .ok_or_else(|| ResolveError::UndeclaredOption {
                method: method_id.to_string(),
                option: option.to_string(),
            })?;
        let checks: Vec<&PromiseCheck> = last_checks
            .iter()
            .filter(|c| c.decides.as_str() == decides.as_str())
            .collect();
        let mut shaped: Vec<String> = Vec::new();
        let touched = decided
            .effects
            .iter()
            .map(effect_step)
            .chain(
                decided
                    .bindings
                    .iter()
                    .filter_map(|b| b.source.step.as_ref().map(|s| s.to_string())),
            )
            .chain(
                checks
                    .iter()
                    .filter_map(|c| c.step.as_ref().map(|s| s.to_string())),
            )
            .chain(decided.evidence.iter().map(|e| e.step.to_string()));
        for step in touched {
            if !shaped.contains(&step) {
                shaped.push(step);
            }
        }
        let promises: Vec<_> = decided
            .promises
            .iter()
            .map(|name| {
                let check = checks
                    .iter()
                    .find(|c| c.verification.as_str() == name.as_str());
                standing(method, name.as_str(), check.copied(), asked, verified)
            })
            .collect::<Result<_, _>>()?;
        let mut decision = json!({
            "decides": decides, "method": method_id, "name": method.name, "activity": method.activity,
            "question": method.question, "option": option, "label": label,
            "reason": decided.reason, "assurance": decided.assurance, "steps": shaped,
            "promises": promises,
        });
        if !decided.bindings.is_empty() {
            decision["bindings"] = json!(decided.bindings);
        }
        if !decided.evidence.is_empty() {
            decision["evidence"] = json!(decided.evidence);
        }
        decisions.push(decision);
    }
    Ok(parse(
        &json!({ "schema_version": "sprisk.flow_decisions/v2", "pipeline_version_id": asked.id,
                 "walk_id": walk_id, "decisions": decisions })
        .to_string(),
    )?)
}

fn effect_step(effect: &GraphEffect) -> String {
    match effect {
        GraphEffect::AddNode { node_id, .. }
        | GraphEffect::InsertNode { node_id, .. }
        | GraphEffect::ReplaceNode { node_id, .. }
        | GraphEffect::RemoveNode { node_id, .. }
        | GraphEffect::SetInput { node_id, .. } => node_id.to_string(),
    }
}

/// A promise's standing on `asked`: the last check's result while nothing before its evidence
/// changed, stale once something did, not evaluated before any check.
fn standing(
    method: &sprisk_contracts::Method,
    name: &str,
    check: Option<&PromiseCheck>,
    asked: &PipelineVersion,
    verified: Option<&PipelineVersion>,
) -> Result<serde_json::Value, ResolveError> {
    let (Some(check), Some(verified)) = (check, verified) else {
        let promise = method
            .verifications
            .iter()
            .find_map(|(k, v)| (k.as_str() == name).then_some(v.promise.to_string()))
            .ok_or_else(|| {
                ResolveError::NotInsertable(format!(
                    "{} promises {name}, which it does not declare",
                    method.id.as_str()
                ))
            })?;
        return Ok(
            json!({ "verification": name, "promise": promise, "status": "not_evaluated",
                          "detail": "Not checked yet: the flow has not run since this was decided." }),
        );
    };
    let mut found = json!({ "verification": name, "promise": check.promise });
    if let Some(step) = &check.step {
        found["step"] = json!(step);
    }
    if fresh(verified, asked, check) {
        found["status"] = json!(check.result);
        found["detail"] = json!(check.detail);
        return Ok(found);
    }
    found["status"] = json!("stale");
    found["last_result"] = json!(check.result);
    let then = if check.result == PromiseResult::NotEvaluated {
        "Then"
    } else {
        "Last time"
    };
    found["detail"] = json!(format!(
        "The step that measured it, or a step before it, changed since it was checked. {then}: {}",
        check.detail.as_str()
    ));
    Ok(found)
}
