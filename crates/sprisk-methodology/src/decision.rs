//! The Rust half of a rule (ADR-0042): what its Python `decide()` reads, and the proposal
//! built from what it returns. Python chooses; Rust builds graph effects only from the
//! manifest's actions, so a rule can never name an operator its manifest does not declare.

use std::collections::{BTreeSet, HashMap, HashSet};

use petgraph::graph::DiGraph;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sprisk_contracts::{
    DatasetProfile, DecisionProposal, MethodologyRule, ModelFamily, ModelPreparation, Node,
    Operator, OperatorModel, PipelineVersion, QuestionVersion, RuleDecision, RuleObservation,
    parse,
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

/// What the flow says about the models downstream of `node_id`, read from their manifests
/// through `operator_of`:
/// - `flow.model_family`: their family, `mixed` for several, `featureless` when none declares
///   one, or `unknown` when a model sits behind a step that does not `keep` these facts (it
///   may change the columns any way);
/// - `flow.models_fill_gaps`, `flow.models_standardize`: whether `all`, `some` or `none` of
///   them do that preparation themselves. A model behind such a step counts as doing none.
///
/// Read from the graph, so `measured`. Left out when no model is downstream, so a rule never
/// reads a stand-in value.
pub fn flow_facts<'a>(
    pipeline: &PipelineVersion,
    node_id: &str,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
    keeps: impl Fn(&Node) -> bool,
) -> Result<Map<String, Value>, ResolveError> {
    let Downstream { models, hidden } = downstream(pipeline, node_id, operator_of, keeps)?;
    let total = models.len() + usize::from(hidden);
    if total == 0 {
        return Ok(Map::new());
    }
    let measured = |value: String| json!({ "value": value, "origin": "measured" });
    let mut facts = Map::new();
    let families: BTreeSet<ModelFamily> = models.iter().filter_map(|m| m.family).collect();
    let family = match (hidden, families.first()) {
        (true, _) => Some("unknown".to_owned()),
        (false, Some(first)) if families.len() == 1 => Some(first.to_string()),
        (false, Some(_)) => Some("mixed".to_owned()),
        // Only models with no family, such as a dummy baseline, which ignores its features.
        (false, None) => Some("featureless".to_owned()),
    };
    if let Some(family) = family {
        facts.insert("flow.model_family".into(), measured(family));
    }
    for (preparation, name) in [
        (ModelPreparation::FillGaps, "flow.models_fill_gaps"),
        (ModelPreparation::Standardize, "flow.models_standardize"),
    ] {
        let doing = models
            .iter()
            .filter(|m| m.prepares.contains(&preparation))
            .count();
        let share = match doing {
            0 => "none",
            n if n == total => "all",
            _ => "some",
        };
        facts.insert(name.into(), measured(share.to_owned()));
    }
    Ok(facts)
}

struct Downstream<'a> {
    /// Models reached from the step through steps that keep the facts.
    models: Vec<&'a OperatorModel>,
    /// Whether a model is reached only through a step that does not.
    hidden: bool,
}

/// The models downstream of `node_id`, not counting itself. The walk stops at a model: the
/// steps after it read its predictions, not the step's columns.
fn downstream<'a>(
    pipeline: &PipelineVersion,
    node_id: &str,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
    keeps: impl Fn(&Node) -> bool,
) -> Result<Downstream<'a>, ResolveError> {
    let mut graph = DiGraph::<&Node, ()>::new();
    let index: HashMap<&str, _> = pipeline
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), graph.add_node(n)))
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
    let start = *index
        .get(node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let mut found = Downstream {
        models: Vec::new(),
        hidden: false,
    };
    // Each step with whether the path to it passed a step that does not keep the facts.
    let mut stack = vec![(start, false)];
    let mut seen = HashSet::new();
    while let Some((at, behind)) = stack.pop() {
        for next in graph.neighbors(at) {
            if !seen.insert((next, behind)) {
                continue;
            }
            let node = graph[next];
            let operator = operator_of(node.operator.as_str())
                .ok_or_else(|| ResolveError::UnknownOperator(node.operator.as_str().to_owned()))?;
            match &operator.model {
                Some(_) if behind => found.hidden = true,
                Some(model) => found.models.push(model),
                None => stack.push((next, behind || !keeps(node))),
            }
        }
    }
    Ok(found)
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
