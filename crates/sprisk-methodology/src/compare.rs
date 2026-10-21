//! The steps that compare a shortlist (ADR-0044, ADR-0046): the split and every step before
//! it, one cross-validate step per candidate fed by the split's train rows, and one select
//! step reading their scores. Nothing reads the split's other outputs.

use std::collections::HashSet;

use petgraph::graph::DiGraph;
use petgraph::visit::Dfs;
use serde_json::json;
use sprisk_contracts::{
    DecisionProposal, Edge, GraphEffect, Node, Operator, PipelineVersion, TaskType, parse,
};

use crate::ResolveError;
use crate::decision::train_rows_chain;

/// Folds, repeats and seed of every comparison, recorded in each cross-validate step's params:
/// ten shuffles into five folds, for the corrected repeated k-fold t-test (ADR-0047).
pub const FOLDS: u64 = 5;
pub const REPEATS: u64 = 10;
pub const SEED: u64 = 0;
const CROSS_VALIDATE: &str = "sprisk.ml.cross_validate@1.0.0";
const SELECT: &str = "sprisk.ml.select_model@1.0.0";
/// The select step of every comparison; its `decision` output is the SelectionDecision.
pub const SELECT_NODE: &str = "select_model";

#[derive(Debug)]
pub struct Comparison {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

/// The comparison of `proposal`'s shortlist on `base`, its flow. `operator_of` finds each
/// candidate's operator, so the baseline is the one model with no family.
pub fn comparison<'a>(
    base: &PipelineVersion,
    proposal: &DecisionProposal,
    task: TaskType,
    is_split: impl Fn(&Node) -> bool,
    keeps_train: impl Fn(&Node) -> bool,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
) -> Result<Comparison, ResolveError> {
    if proposal.shortlist.is_empty() {
        return Err(ResolveError::Selection(format!(
            "proposal {} has no shortlist to compare",
            proposal.id.as_str()
        )));
    }
    // Fixed before any score is seen (ADR-0044).
    let metric = match task {
        TaskType::Classification => "balanced_accuracy",
        TaskType::Regression => "rmse",
        other => {
            return Err(ResolveError::Selection(format!(
                "a {other} question has no metric to compare models by"
            )));
        }
    };
    let chain = train_rows_chain(
        base,
        proposal.subject_node_id.as_str(),
        is_split,
        keeps_train,
    )?;
    let (split, between) = chain
        .split_last()
        .ok_or_else(|| ResolveError::NotTrainRows("no split feeds the model".into()))?;
    // Folds must keep what the split keeps apart: time order, or whole groups (ADR-0047).
    let split_node = base
        .nodes
        .iter()
        .find(|n| n.id.as_str() == *split)
        .ok_or_else(|| ResolveError::UnknownNode((*split).to_owned()))?;
    let (fold_by, repeats) = fold_by(split_node)?;

    // Every step between the split and the model fits on train (the walk above refuses any
    // other), so each fold refits them, in flow order, before the candidate (ADR-0047).
    let prepare = between
        .iter()
        .rev()
        .map(|id| {
            let step = base
                .nodes
                .iter()
                .find(|n| n.id.as_str() == *id)
                .ok_or_else(|| ResolveError::UnknownNode((*id).to_owned()))?;
            Ok(json!({ "operator": step.operator, "params": step.params }))
        })
        .collect::<Result<Vec<_>, ResolveError>>()?;

    let kept = upstream(base, split);
    let mut nodes: Vec<Node> = base
        .nodes
        .iter()
        .filter(|n| kept.contains(n.id.as_str()))
        .cloned()
        .collect();
    let within = |port: &sprisk_contracts::PortRef| kept.contains(port.step_and_port().0);
    let mut edges: Vec<Edge> = base
        .edges
        .iter()
        .filter(|e| within(&e.from) && within(&e.to))
        .cloned()
        .collect();

    let mut trials = Vec::new();
    let mut baselines = Vec::new();
    let mut complexity = serde_json::Map::new();
    for id in &proposal.shortlist {
        let id = id.as_str();
        let (operator, params) = candidate(proposal, id)?;
        let model = operator_of(operator)
            .ok_or_else(|| ResolveError::UnknownOperator(operator.to_owned()))?
            .model
            .as_ref()
            .ok_or_else(|| ResolveError::Selection(format!("{operator} is not a model")))?;
        if model.family.is_none() {
            baselines.push(id);
        }
        // The one-SE rule ranks candidates by it (ADR-0047); the registry requires it.
        let rank = model
            .complexity
            .ok_or_else(|| ResolveError::Selection(format!("{operator} declares no complexity")))?;
        complexity.insert(id.to_owned(), json!(rank));
        let step = format!("cv_{id}");
        let mut cv_params = serde_json::Map::new();
        cv_params.insert("candidate".into(), json!(operator));
        cv_params.insert("candidate_params".into(), json!(params));
        cv_params.insert("folds".into(), json!(FOLDS));
        cv_params.insert("repeats".into(), json!(repeats));
        cv_params.insert("seed".into(), json!(SEED));
        cv_params.insert("metric".into(), json!(metric));
        cv_params.insert("prepare".into(), json!(prepare));
        cv_params.extend(fold_by.clone());
        nodes.push(parse(
            &json!({ "id": step, "operator": CROSS_VALIDATE, "params": cv_params }).to_string(),
        )?);
        edges.push(edge(&format!("{split}.train"), &format!("{step}.train"))?);
        trials.push((id, step));
    }
    let [baseline] = baselines[..] else {
        return Err(ResolveError::Selection(format!(
            "a comparison needs exactly one baseline, a model with no family, on the shortlist; found {}",
            baselines.len()
        )));
    };
    for (id, step) in &trials {
        edges.push(edge(
            &format!("{step}.scores"),
            &format!("{SELECT_NODE}.{id}"),
        )?);
    }
    nodes.push(parse(
        &json!({
            "id": SELECT_NODE, "operator": SELECT,
            "params": {
                "trials": trials.iter().map(|(id, _)| id).collect::<Vec<_>>(),
                "baseline": baseline, "metric": metric, "complexity": complexity
            }
        })
        .to_string(),
    )?);
    Ok(Comparison { nodes, edges })
}

/// How folds must follow `split`, as cross-validate params, and how many repeats that allows:
/// a time split's folds follow its time column and cannot be reshuffled; a group split's keep
/// its groups whole; a random split's shuffle rows (ADR-0047).
fn fold_by(
    split: &Node,
) -> Result<(serde_json::Map<String, serde_json::Value>, u64), ResolveError> {
    let operator = split.operator.as_str();
    let column = |name: &str| {
        split
            .params
            .get(name)
            .filter(|v| v.is_string())
            .cloned()
            .ok_or_else(|| {
                ResolveError::Selection(format!("split step {} names no {name}", split.id.as_str()))
            })
    };
    let mut by = serde_json::Map::new();
    if operator.starts_with("sprisk.validation.temporal_split@") {
        by.insert("time_column".into(), column("time_column")?);
        Ok((by, 1))
    } else if operator.starts_with("sprisk.validation.group_split@") {
        by.insert("group_column".into(), column("group_column")?);
        Ok((by, REPEATS))
    } else if operator.starts_with("sprisk.validation.random_split@") {
        Ok((by, REPEATS))
    } else {
        Err(ResolveError::Selection(format!(
            "split step {} ({operator}) has no fold rule; compare knows random, temporal and group splits",
            split.id.as_str()
        )))
    }
}

/// The operator and params a shortlisted alternative puts in the model step's place.
fn candidate<'p>(
    proposal: &'p DecisionProposal,
    id: &str,
) -> Result<(&'p str, &'p serde_json::Map<String, serde_json::Value>), ResolveError> {
    let effect = proposal
        .alternatives
        .iter()
        .find(|a| a.id.as_str() == id)
        .and_then(|a| a.effect.as_ref());
    match effect {
        Some(GraphEffect::ReplaceNode {
            operator, params, ..
        }) => Ok((operator.as_str(), params)),
        _ => Err(ResolveError::Selection(format!(
            "shortlisted {id} replaces no model, so it cannot be compared"
        ))),
    }
}

/// `step` and every step it depends on.
fn upstream<'p>(pipeline: &'p PipelineVersion, step: &str) -> HashSet<&'p str> {
    let mut graph = DiGraph::<&str, ()>::new();
    let index: std::collections::HashMap<&str, _> = pipeline
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), graph.add_node(n.id.as_str())))
        .collect();
    for edge in &pipeline.edges {
        let from = index.get(edge.from.step_and_port().0);
        let to = index.get(edge.to.step_and_port().0);
        if let (Some(from), Some(to)) = (from, to) {
            graph.add_edge(*to, *from, ());
        }
    }
    let mut found = HashSet::new();
    if let Some(start) = index.get(step) {
        let mut dfs = Dfs::new(&graph, *start);
        while let Some(at) = dfs.next(&graph) {
            found.insert(graph[at]);
        }
    }
    found
}

fn edge(from: &str, to: &str) -> Result<Edge, ResolveError> {
    Ok(parse(&json!({ "from": from, "to": to }).to_string())?)
}
