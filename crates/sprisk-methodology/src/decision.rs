//! The Rust half of a rule (ADR-0042): what its Python `decide()` reads, and the proposal
//! built from what it returns. Python chooses; Rust builds graph effects only from the
//! manifest's actions, so a rule can never name an operator its manifest does not declare.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use petgraph::graph::DiGraph;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sprisk_contracts::{
    CapabilityClass, DatasetProfile, DecisionProposal, Edge, MethodologyRule, ModelPreparation,
    Node, Operator, OperatorModel, PipelineVersion, PortRef, QuestionVersion, RuleActionType,
    RuleDecision, RuleDecisionAlternativesItemApplicability, RuleObservation, parse,
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
/// through `operator_of`. A model is hidden when it sits behind a step that does not `keep`
/// these facts, or behind another model: either may change the columns any way.
/// - `flow.model_families`: the families of the models it can see, sorted and joined by
///   `, `, or `featureless` when none of them declares one;
/// - `flow.models_hidden`: whether `all`, `some` or `none` of the models are hidden;
/// - `flow.models_fill_gaps`, `flow.models_standardize`: whether `all`, `some` or `none` of
///   them do that preparation themselves. A hidden model counts as doing none;
/// - `flow.other_readers`: the analysis or code steps downstream, which read the columns,
///   sorted and joined by `, `. Removing the step would change what they see;
/// - `step.<name>`: each text setting of the step itself, as set, so a rule knows what it
///   does now.
///
/// Read from the graph, so `measured`. Left out when no model is downstream, so a rule never
/// reads a stand-in value.
pub fn flow_facts<'a>(
    pipeline: &PipelineVersion,
    node_id: &str,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
    keeps: impl Fn(&Node) -> bool,
) -> Result<Map<String, Value>, ResolveError> {
    let Downstream {
        seen,
        hidden,
        readers,
    } = downstream(pipeline, node_id, operator_of, keeps)?;
    let measured = |value: &str| json!({ "value": value, "origin": "measured" });
    let mut facts = Map::new();
    let step = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;
    for (name, value) in step.params.iter() {
        if let Some(text) = value.as_str().filter(|t| !t.is_empty()) {
            facts.insert(
                format!("step.{name}"),
                json!({ "value": text, "origin": "explicit" }),
            );
        }
    }
    if !readers.is_empty() {
        let readers: Vec<String> = readers.into_iter().collect();
        facts.insert("flow.other_readers".into(), measured(&readers.join(", ")));
    }
    let total = seen.len() + hidden;
    if total == 0 {
        return Ok(facts);
    }
    let share = |doing: usize| match doing {
        0 => "none",
        n if n == total => "all",
        _ => "some",
    };
    if !seen.is_empty() {
        let families: BTreeSet<String> = seen
            .iter()
            .filter_map(|m| m.family)
            .map(|f| f.to_string())
            .collect();
        let families = if families.is_empty() {
            // Only models with no family, such as a dummy baseline, which ignores its features.
            "featureless".to_owned()
        } else {
            families.into_iter().collect::<Vec<_>>().join(", ")
        };
        facts.insert("flow.model_families".into(), measured(&families));
    }
    facts.insert("flow.models_hidden".into(), measured(share(hidden)));
    for (preparation, name) in [
        (ModelPreparation::FillGaps, "flow.models_fill_gaps"),
        (ModelPreparation::Standardize, "flow.models_standardize"),
    ] {
        let doing = seen
            .iter()
            .filter(|m| m.prepares.contains(&preparation))
            .count();
        facts.insert(name.into(), measured(share(doing)));
    }
    Ok(facts)
}

struct Downstream<'a> {
    /// Models reached only through steps that keep the facts.
    seen: Vec<&'a OperatorModel>,
    /// How many models are reached through a step that does not.
    hidden: usize,
    /// Analysis or code steps that read the columns. Removing the step would change what
    /// they see.
    readers: BTreeSet<String>,
}

/// The models downstream of `node_id`, not counting itself.
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
    let step = |port: &PortRef| index.get(port.step_and_port().0).copied();
    for edge in &pipeline.edges {
        if let (Some(from), Some(to)) = (step(&edge.from), step(&edge.to)) {
            graph.add_edge(from, to, ());
        }
    }
    let start = *index
        .get(node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let mut seen = BTreeMap::new();
    let mut hidden = BTreeSet::new();
    let mut readers = BTreeSet::new();
    // Each step with whether the path to it passed a step that does not keep the facts.
    let mut stack = vec![(start, false)];
    let mut visited = HashSet::new();
    while let Some((at, behind)) = stack.pop() {
        for next in graph.neighbors(at) {
            if !visited.insert((next, behind)) {
                continue;
            }
            let node = graph[next];
            let operator = operator_of(node.operator.as_str())
                .ok_or_else(|| ResolveError::UnknownOperator(node.operator.as_str().to_owned()))?;
            if let Some(model) = &operator.model {
                if behind {
                    hidden.insert(next);
                } else {
                    seen.insert(next, model);
                }
            } else if operator.capability_class == CapabilityClass::Analyzer {
                // An analysis or code step reads the columns, even behind another step.
                readers.insert(node.id.as_str().to_owned());
            }
            // A model's output may carry the columns on (a clustering step adds a label to
            // its input table), changed by a fit, so what follows a model is behind it.
            let keeps_columns = operator.model.is_none() && keeps(node);
            stack.push((next, behind || !keeps_columns));
        }
    }
    // A model reached both ways may see changed columns, so it counts as hidden only.
    seen.retain(|step, _| !hidden.contains(step));
    Ok(Downstream {
        seen: seen.into_values().collect(),
        hidden: hidden.len(),
        readers,
    })
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
            ("iqr", column.iqr),
        ] {
            if let Some(value) = value {
                facts.insert(key(measure), json!(value));
            }
        }
    }
    facts
}

/// The steps and edges of `pipeline` without `node_id` (ADR-0043): each edge out of
/// `node_id.P` is fed from whatever fed `node_id.P`, and edges into it are dropped. Refused
/// when an output with consumers has no input of the same name to take its place.
pub fn without_node(
    pipeline: &PipelineVersion,
    node_id: &str,
) -> Result<(Vec<Node>, Vec<Edge>), ResolveError> {
    if !pipeline.nodes.iter().any(|n| n.id.as_str() == node_id) {
        return Err(ResolveError::UnknownNode(node_id.to_owned()));
    }
    let port_of = |port: &PortRef| {
        let (step, name) = port.step_and_port();
        (step == node_id).then(|| name.to_owned())
    };
    let feeds: HashMap<String, &PortRef> = pipeline
        .edges
        .iter()
        .filter_map(|e| Some((port_of(&e.to)?, &e.from)))
        .collect();
    let mut edges = Vec::new();
    for edge in &pipeline.edges {
        if port_of(&edge.to).is_some() {
            continue;
        }
        match port_of(&edge.from) {
            None => edges.push(edge.clone()),
            Some(port) => {
                let from = feeds
                    .get(&port)
                    .ok_or_else(|| ResolveError::Unremovable(edge.from.as_str().to_owned()))?;
                edges.push(Edge {
                    from: (*from).clone(),
                    to: edge.to.clone(),
                });
            }
        }
    }
    let nodes = pipeline
        .nodes
        .iter()
        .filter(|n| n.id.as_str() != node_id)
        .cloned()
        .collect();
    Ok((nodes, edges))
}

/// The proposal for `node_id`: each decided alternative with the manifest's label and
/// description, and, where applicable, its effect: `replace_node` with the manifest's
/// operator, or `remove_node` when the manifest's action says so (ADR-0043).
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
        let applicable = matches!(
            decided.applicability,
            RuleDecisionAlternativesItemApplicability::Applicable
        );
        if declared.action.type_ == RuleActionType::RemoveNode {
            if applicable {
                built["effect"] = json!({ "kind": "remove_node", "node_id": node_id });
            }
        } else if let (Some(params), Some(operator)) = (&decided.params, &declared.action.operator)
        {
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
