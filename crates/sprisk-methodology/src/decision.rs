//! The Rust half of a rule (ADR-0042): what its Python `decide()` reads, and the proposal
//! built from what it returns. Python chooses; Rust builds graph effects only from the
//! manifest's actions, so a rule can never name an operator its manifest does not declare.

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sprisk_contracts::{
    DecisionProposal, MethodologyRule, PipelineVersion, QuestionVersion, RuleDecision,
    RuleObservation, parse,
};

use crate::ResolveError;

/// Question fields a rule may read, as `question.<field>` facts.
const QUESTION_FACTS: &[&str] = &[
    "target",
    "task",
    "unit_of_analysis",
    "entity_column",
    "time_column",
    "prediction_horizon",
];

/// The rule's observation of this question. Its settings are the manifest's thresholds.
pub fn observation(
    rule: &MethodologyRule,
    question: &QuestionVersion,
) -> Result<RuleObservation, ResolveError> {
    let question = serde_json::to_value(question)?;
    let facts: Map<String, Value> = QUESTION_FACTS
        .iter()
        .filter_map(|field| Some((format!("question.{field}"), question.get(*field)?.clone())))
        .collect();
    Ok(parse(
        &json!({
            "schema_version": "sprisk.rule_observation/v1",
            "rule": rule.id,
            "facts": facts,
            "profile": {},
            "settings": rule.policy_thresholds,
        })
        .to_string(),
    )?)
}

/// The proposal for `node_id`: each decided alternative with the manifest's label and
/// description, and, where applicable, a `replace_node` effect with the manifest's operator.
pub fn proposal(
    rule: &MethodologyRule,
    decision: &RuleDecision,
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
) -> Result<DecisionProposal, ResolveError> {
    if !pipeline.nodes.iter().any(|n| n.id.as_str() == node_id) {
        return Err(ResolveError::UnknownNode(node_id.to_owned()));
    }
    let manifest = serde_json::to_value(&rule.alternatives)?;
    let decided = serde_json::to_value(&decision.alternatives)?;
    let mut alternatives = Vec::new();
    for alternative in decided.as_array().into_iter().flatten() {
        let id = alternative["id"].as_str().unwrap_or_default();
        let declared = manifest
            .as_array()
            .into_iter()
            .flatten()
            .find(|m| m["id"] == id)
            .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
        let mut built = json!({
            "id": id,
            "label": declared["label"],
            "description": declared["description"],
            "applicability": alternative["applicability"],
            "reason": alternative["reason"],
        });
        if let (Some(params), Some(operator)) = (
            alternative.get("params"),
            declared["action"].get("operator"),
        ) {
            built["effect"] = json!({ "kind": "replace_node", "node_id": node_id, "operator": operator, "params": params });
        }
        alternatives.push(built);
    }
    let fingerprint_input =
        json!({ "rule": rule.id, "question": question, "pipeline": pipeline, "node_id": node_id });
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    Ok(parse(
        &json!({
            "schema_version": "sprisk.decision_proposal/v1",
            "id": proposal_id,
            "rule": rule.id,
            "question_version_id": question.id,
            "pipeline_version_id": pipeline.id,
            "subject_node_id": node_id,
            "evidence": decision.evidence,
            "alternatives": alternatives,
            "recommended_alternative_id": decision.recommended_alternative_id,
            "fingerprint": fingerprint,
            "created_at": created_at,
        })
        .to_string(),
    )?)
}
