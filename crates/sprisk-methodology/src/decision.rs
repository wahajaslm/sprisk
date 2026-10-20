//! The Rust half of a rule (ADR-0042): what its Python `decide()` reads, and the proposal
//! built from what it returns. Python chooses; Rust builds graph effects only from the
//! manifest's actions, so a rule can never name an operator its manifest does not declare.

use std::collections::BTreeSet;

use petgraph::graph::DiGraph;
use petgraph::visit::Bfs;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sprisk_contracts::{
    DatasetProfile, DecisionProposal, MethodologyRule, ModelFamily, PipelineVersion,
    QuestionVersion, RuleDecision, RuleObservation, parse,
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

/// The rule's observation of this question, of the flow around the step (`flow_facts`)
/// and, for rules that read data, of the step's train rows (`profile_facts`). Its settings
/// are the manifest's thresholds.
pub fn observation(
    rule: &MethodologyRule,
    question: &QuestionVersion,
    flow: Map<String, Value>,
    profile: Map<String, Value>,
) -> Result<RuleObservation, ResolveError> {
    let question = serde_json::to_value(question)?;
    let mut facts: Map<String, Value> = QUESTION_FACTS
        .iter()
        .filter_map(|field| Some((format!("question.{field}"), question.get(*field)?.clone())))
        .collect();
    facts.extend(flow);
    Ok(parse(
        &json!({
            "schema_version": "sprisk.rule_observation/v1",
            "rule": rule.id,
            "facts": facts,
            "profile": profile,
            "settings": rule.policy_thresholds,
        })
        .to_string(),
    )?)
}

/// What the flow says about `node_id`: `flow.model_family`, the family of the models
/// downstream of it, or `mixed` for several. `family_of` reads an operator's manifest.
/// Read from the graph, so `measured`; left out when no model is downstream, so a rule
/// never reads a stand-in family.
pub fn flow_facts(
    pipeline: &PipelineVersion,
    node_id: &str,
    family_of: impl Fn(&str) -> Option<ModelFamily>,
) -> Map<String, Value> {
    let mut graph = DiGraph::<&str, ()>::new();
    let index: std::collections::HashMap<&str, _> = pipeline
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), graph.add_node(n.operator.as_str())))
        .collect();
    let step = |port: &str| {
        port.split_once('.')
            .and_then(|(id, _)| index.get(id).copied())
    };
    for edge in &pipeline.edges {
        if let (Some(from), Some(to)) = (step(edge.from.as_str()), step(edge.to.as_str())) {
            graph.add_edge(from, to, ());
        }
    }
    let Some(&start) = index.get(node_id) else {
        return Map::new();
    };
    let mut families = BTreeSet::new();
    let mut bfs = Bfs::new(&graph, start);
    while let Some(next) = bfs.next(&graph) {
        families.extend(family_of(graph[next]));
    }
    let Some(first) = families.first() else {
        return Map::new();
    };
    let family = if families.len() == 1 {
        first.to_string()
    } else {
        "mixed".to_owned()
    };
    let mut facts = Map::new();
    facts.insert(
        "flow.model_family".into(),
        json!({ "value": family, "origin": "measured" }),
    );
    facts
}

/// Measured values of `columns`, as `column.<name>.<measure>`, plus `rows`. Only the step's
/// columns: a rule decides about the step it serves. A measure the profile left out (no
/// variation, not numeric) stays out, so a rule never reads a stand-in value.
pub fn profile_facts(profile: &DatasetProfile, columns: &[String]) -> Map<String, Value> {
    let mut facts = Map::new();
    facts.insert("rows".into(), json!(profile.profiled_rows));
    for column in profile.columns.iter().filter(|c| columns.contains(&c.name)) {
        let key = |measure: &str| format!("column.{}.{measure}", column.name);
        let share = if profile.profiled_rows == 0 {
            0.0
        } else {
            column.missing as f64 / profile.profiled_rows as f64
        };
        facts.insert(key("missing_share"), json!(share));
        facts.insert(key("distinct"), json!(column.distinct));
        facts.insert(key("data_type"), json!(column.data_type));
        for (measure, value) in [
            ("skewness", column.skewness),
            ("kurtosis", column.kurtosis),
            ("outlier_share", column.outlier_share),
        ] {
            if let Some(value) = value {
                facts.insert(key(measure), json!(value));
            }
        }
    }
    facts
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
    let mut alternatives = Vec::new();
    for decided in &decision.alternatives {
        let id = decided.id.as_str();
        let declared = rule
            .alternatives
            .iter()
            .find(|m| m.id.as_str() == id)
            .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
        let mut built = json!({
            "id": id,
            "label": declared.label,
            "description": declared.description,
            "applicability": decided.applicability,
            "reason": decided.reason,
        });
        if let (Some(params), Some(operator)) = (&decided.params, &declared.action.operator) {
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
