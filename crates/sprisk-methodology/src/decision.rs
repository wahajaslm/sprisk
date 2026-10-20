//! The Rust half of a rule (ADR-0042): what its Python `decide()` reads, and the proposal
//! built from what it returns. Python chooses; Rust builds graph effects only from the
//! manifest's actions, so a rule can never name an operator its manifest does not declare.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use petgraph::graph::DiGraph;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sprisk_contracts::{
    CapabilityClass, DatasetProfile, DecisionProposal, Edge, MethodologyRule,
    MethodologyRuleSelection, ModelPreparation, Node, Operator, OperatorModel, PipelineVersion,
    PortRef, QuestionVersion, RuleActionType, RuleDecision,
    RuleDecisionAlternativesItemApplicability, RuleObservation, TaskType, parse,
};

use crate::{ResolveError, facts};

/// The rule's observation of this question, of the flow around the step (`flow_facts`)
/// and, for rules that read data, of the step's train rows (`profile_facts`), holding only
/// the facts the rule `reads` (ADR-0045). Its settings are the manifest's thresholds.
pub fn observation(
    rule: &MethodologyRule,
    question: &QuestionVersion,
    flow: Map<String, Value>,
    profile: Map<String, Value>,
) -> Result<RuleObservation, ResolveError> {
    let question = serde_json::to_value(question)?;
    let mut facts: Map<String, Value> = facts::FACTS
        .iter()
        .filter_map(|name| Some((*name, question.get(name.strip_prefix("question.")?)?)))
        .map(|(name, fact)| (name.to_owned(), fact.clone()))
        .collect();
    facts.extend(flow);
    // A rule sees only the facts it declares it reads (ADR-0045).
    let reads = |name: &String| rule.reads.iter().any(|r| facts::covers(r.as_str(), name));
    facts.retain(|name, _| reads(name));
    let mut profile = profile;
    profile.retain(|name, _| reads(name));
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

/// The step whose `train` output feeds `node_id`'s `train` input, walked back to a split's
/// train output through steps that `keep_train` (ADR-0044, rule 8). Every hop is a train port
/// through a step that writes train rows from train rows only, so the table holds no test row.
pub fn train_rows_source<'p>(
    pipeline: &'p PipelineVersion,
    node_id: &str,
    is_split: impl Fn(&Node) -> bool,
    keeps_train: impl Fn(&Node) -> bool,
) -> Result<&'p str, ResolveError> {
    let node = |id: &str| pipeline.nodes.iter().find(|n| n.id.as_str() == id);
    let feeding = |id: &str| {
        pipeline
            .edges
            .iter()
            .find(|e| e.to.as_str() == format!("{id}.train"))
            .map(|e| e.from.step_and_port())
            .filter(|(_, port)| *port == "train")
            .map(|(step, _)| step)
    };
    let refuse = |why: String| Err(ResolveError::NotTrainRows(why));
    let Some(source) = feeding(node_id) else {
        return refuse(format!(
            "step {node_id} takes no train output into its train input"
        ));
    };
    let mut at = source;
    loop {
        let Some(step) = node(at) else {
            return Err(ResolveError::UnknownNode(at.to_owned()));
        };
        if is_split(step) {
            return Ok(source);
        }
        if !keeps_train(step) {
            return refuse(format!(
                "step {at} ({}) may mix rows between its inputs, so its train output may hold test rows",
                step.operator.as_str()
            ));
        }
        let Some(next) = feeding(at) else {
            return refuse(format!(
                "step {at} takes no train output into its train input"
            ));
        };
        at = next;
    }
}

/// A new proposal's id and when it was made.
pub struct Stamp<'a> {
    pub id: &'a str,
    pub created_at: &'a str,
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
    candidates: &BTreeMap<String, &Operator>,
    stamp: Stamp,
) -> Result<DecisionProposal, ResolveError> {
    let node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;
    let shortlist = rule.selection == Some(MethodologyRuleSelection::Shortlist);
    check_selection(decision, shortlist)?;
    // The baseline is the floor a comparison measures against (ADR-0044).
    let baseline = |id: &str| {
        candidates
            .get(id)
            .is_some_and(|o| o.model.as_ref().is_some_and(|m| m.family.is_none()))
    };
    if shortlist && !decision.shortlist.iter().any(|id| baseline(id.as_str())) {
        return Err(ResolveError::Selection(
            "a shortlist needs the baseline, a model with no family, to compare against".into(),
        ));
    }
    let mut alternatives = Vec::new();
    for decided in &decision.alternatives {
        let id = decided.id.as_str();
        let mut built = json!({
            "id": id,
            "applicability": decided.applicability,
            "reason": decided.reason,
        });
        let applicable = matches!(
            decided.applicability,
            RuleDecisionAlternativesItemApplicability::Applicable
        );
        if shortlist {
            let operator = candidates
                .get(id)
                .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
            built["label"] = json!(operator.id);
            built["description"] = json!(operator.description);
            if applicable {
                built["effect"] = json!({ "kind": "replace_node", "node_id": node_id, "operator": operator.id, "params": params_for(operator, node) });
            }
        } else {
            let declared = rule
                .alternatives
                .iter()
                .find(|m| m.id.as_str() == id)
                .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
            built["label"] = json!(declared.label);
            built["description"] = json!(declared.description);
            if declared.action.type_ == RuleActionType::RemoveNode {
                if applicable {
                    built["effect"] = json!({ "kind": "remove_node", "node_id": node_id });
                }
            } else if let (Some(params), Some(operator)) =
                (&decided.params, &declared.action.operator)
            {
                built["effect"] = json!({ "kind": "replace_node", "node_id": node_id, "operator": operator, "params": params });
            }
        }
        alternatives.push(built);
    }
    let fingerprint_input =
        json!({ "rule": rule.id, "question": question, "pipeline": pipeline, "node_id": node_id });
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let mut built = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": stamp.id,
        "rule": rule.id,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": decision.evidence,
        "alternatives": alternatives,
        "fingerprint": fingerprint,
        "created_at": stamp.created_at,
    });
    if let Some(recommended) = &decision.recommended_alternative_id {
        built["recommended_alternative_id"] = json!(recommended);
    }
    if shortlist {
        built["shortlist"] = json!(decision.shortlist);
    }
    Ok(parse(&built.to_string())?)
}

/// A recommend rule picks one alternative it offers; a shortlist rule puts forward some it
/// offers and picks none (ADR-0044).
fn check_selection(decision: &RuleDecision, shortlist: bool) -> Result<(), ResolveError> {
    let offered = |id: &str| decision.alternatives.iter().any(|a| a.id.as_str() == id);
    let recommended = decision.recommended_alternative_id.as_ref();
    let problem = match (shortlist, recommended) {
        (false, None) => Some("a recommend rule must pick an alternative".to_owned()),
        (false, Some(_)) if !decision.shortlist.is_empty() => {
            Some("a recommend rule gives no shortlist".to_owned())
        }
        (false, Some(r)) if !offered(r.as_str()) => Some(format!(
            "it recommends {}, which it does not offer",
            r.as_str()
        )),
        (true, Some(_)) => Some("a shortlist rule recommends no single alternative".to_owned()),
        (true, None) if decision.shortlist.is_empty() => {
            Some("a shortlist rule must put forward at least one alternative".to_owned())
        }
        (true, None) => decision
            .shortlist
            .iter()
            .find(|id| !offered(id.as_str()))
            .map(|id| format!("it shortlists {}, which it does not offer", id.as_str())),
        _ => None,
    };
    problem.map_or(Ok(()), |p| Err(ResolveError::Selection(p)))
}

/// The step's params that `operator` accepts, so a candidate keeps the step's target,
/// features and task.
fn params_for(operator: &Operator, node: &Node) -> Map<String, Value> {
    let accepted = operator
        .params_schema
        .get("properties")
        .and_then(Value::as_object);
    node.params
        .iter()
        .filter(|(name, _)| accepted.is_some_and(|a| a.contains_key(*name)))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect()
}

/// The id a candidate model goes by: its operator name without `sprisk.`, with dots as
/// underscores, e.g. `ml_random_forest`.
fn candidate_id(operator: &Operator) -> String {
    let name = operator.id.as_str().split('@').next().unwrap_or_default();
    name.strip_prefix("sprisk.")
        .unwrap_or(name)
        .replace('.', "_")
}

/// The registered models that fit `task`, by candidate id (ADR-0044). Two models with one
/// id, such as two versions of one model, are refused: one would silently hide the other.
pub fn candidates<'a>(
    task: TaskType,
    operators: impl Iterator<Item = &'a Operator>,
) -> Result<BTreeMap<String, &'a Operator>, ResolveError> {
    let mut found = BTreeMap::new();
    let fits = |o: &Operator| o.model.as_ref().is_some_and(|m| m.tasks.contains(&task));
    for operator in operators.filter(|o| fits(o)) {
        let id = candidate_id(operator);
        if let Some(first) = found.insert(id.clone(), operator) {
            return Err(ResolveError::SharedCandidateId {
                id,
                first: first.id.to_string(),
                second: operator.id.to_string(),
            });
        }
    }
    Ok(found)
}

/// `candidate.<id>.family` for each candidate, `featureless` for one with no family.
pub fn candidate_facts(candidates: &BTreeMap<String, &Operator>) -> Map<String, Value> {
    candidates
        .iter()
        .map(|(id, operator)| {
            let family = operator
                .model
                .as_ref()
                .and_then(|m| m.family)
                .map_or_else(|| "featureless".to_owned(), |f| f.to_string());
            (
                format!("candidate.{id}.family"),
                json!({ "value": family, "origin": "measured" }),
            )
        })
        .collect()
}
