//! The steps that compare a shortlist of models (ADR-0044, ADR-0046), or the ways of doing one
//! preparation step (ADR-0047): the split and every step before it, one cross-validate step
//! per trial fed by the split's train rows, and one select step reading their scores. Nothing
//! reads the split's other outputs.

use std::collections::HashSet;

use petgraph::graph::DiGraph;
use petgraph::visit::Dfs;
use serde_json::json;
use sprisk_contracts::{
    BaselineRole, DecisionProposal, Edge, GraphEffect, MethodologyAlternative,
    MethodologyAlternativeApplicability, MethodologyRule, Node, Operator, PipelineVersion,
    TaskType, parse,
};

use crate::ResolveError;
use crate::decision::train_rows_chain;

/// Folds, repeats and seed of every comparison, recorded in each cross-validate step's params:
/// ten shuffles into five folds, for the corrected repeated k-fold t-test (ADR-0047).
pub const FOLDS: u64 = 5;
pub const REPEATS: u64 = 10;
pub const SEED: u64 = 0;
const CROSS_VALIDATE: &str = "sprisk.ml.cross_validate@2.0.0";
const SELECT: &str = "sprisk.ml.select_model@3.0.0";
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
    let metric = metric_of(task)?;
    let chain = train_rows_chain(
        base,
        proposal.subject_node_id.as_str(),
        is_split,
        keeps_train,
    )?;
    let (split, between) = chain
        .split_last()
        .ok_or_else(|| ResolveError::NotTrainRows("no split feeds the model".into()))?;
    // Every step between the split and the model fits on train (the walk above refuses any
    // other), so each fold refits them, in flow order, before the candidate (ADR-0047).
    let prepare = between
        .iter()
        .rev()
        .map(|id| as_prepared(step_of(base, id)?))
        .collect::<Result<Vec<_>, ResolveError>>()?;

    let mut trials = Vec::new();
    let mut baselines = Vec::new();
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
        let complexity = model
            .complexity
            .ok_or_else(|| ResolveError::Selection(format!("{operator} declares no complexity")))?;
        trials.push(Trial {
            id,
            model: operator,
            model_params: params,
            prepare: prepare.clone(),
            complexity,
        });
    }
    let [baseline] = baselines[..] else {
        return Err(ResolveError::Selection(format!(
            "a comparison needs exactly one baseline, a model with no family, on the shortlist; found {}",
            baselines.len()
        )));
    };
    let not_compared = proposal
        .alternatives
        .iter()
        .filter(|a| !proposal.shortlist.iter().any(|s| s.as_str() == a.id.as_str()))
        .map(|a| {
            json!({ "id": a.id.as_str(), "reason": format!("Not on the shortlist: {}", a.reason.as_str()) })
        })
        .collect();
    build(
        base,
        split,
        metric,
        &trials,
        Baseline {
            id: baseline,
            role: BaselineRole::Floor,
        },
        not_compared,
    )
}

/// The comparison of the ways `proposal` offers of doing its preparation step (ADR-0047):
/// each alternative that can be refit within each fold is one trial of the flow's model,
/// unchanged, with the step replaced or removed. The rule's recommendation is the reference:
/// it stands unless another beats it. `rule` is the proposal's manifest, which says where an
/// alternative without an effect would act.
pub fn preparation_comparison<'a>(
    base: &PipelineVersion,
    proposal: &DecisionProposal,
    rule: &MethodologyRule,
    task: TaskType,
    is_split: impl Fn(&Node) -> bool,
    keeps_train: impl Fn(&Node) -> bool,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
) -> Result<Comparison, ResolveError> {
    let reference = proposal
        .recommended_alternative_id
        .as_ref()
        .map(|r| r.as_str())
        .ok_or_else(|| {
            ResolveError::Selection(format!(
                "proposal {} recommends nothing to compare against",
                proposal.id.as_str()
            ))
        })?;
    let metric = metric_of(task)?;
    let subject = proposal.subject_node_id.as_str();
    let (model, chain) = model_after(base, subject, &is_split, &keeps_train, &operator_of)?;
    let (split, between) = chain
        .split_last()
        .ok_or_else(|| ResolveError::NotTrainRows("no split feeds the model".into()))?;

    let mut trials = Vec::new();
    let mut not_compared = Vec::new();
    let mut reference_unmeasured = None;
    for alternative in &proposal.alternatives {
        let id = alternative.id.as_str();
        let measured = measured_step(rule, alternative, &operator_of);
        let step = match measured {
            Ok(step) => step,
            Err(why) if id == reference => {
                reference_unmeasured = Some(why);
                continue;
            }
            Err(why) => {
                not_compared.push(json!({ "id": id, "reason": why }));
                continue;
            }
        };
        let mut prepare = Vec::new();
        for at in between.iter().rev() {
            if *at != subject {
                prepare.push(as_prepared(step_of(base, at)?)?);
            } else if let Some(replaced) = &step {
                prepare.push(replaced.clone());
            }
        }
        trials.push(Trial {
            id,
            model: model.operator.as_str(),
            model_params: &model.params,
            prepare,
            // Removing the step is simplest; every way of keeping it ranks the same (ADR-0047).
            complexity: u64::from(step.is_some()),
        });
    }
    if let Some(why) = reference_unmeasured {
        return Err(ResolveError::NothingToCompare(format!(
            "the recommendation {reference} cannot be measured here: {why}"
        )));
    }
    if trials.len() < 2 {
        return Err(ResolveError::NothingToCompare(format!(
            "only the recommendation {reference} can be measured here; there is nothing to compare it with"
        )));
    }
    build(
        base,
        split,
        metric,
        &trials,
        Baseline {
            id: reference,
            role: BaselineRole::Reference,
        },
        not_compared,
    )
}

/// One cross-validate step: `model` refit after `prepare` on each fold.
struct Trial<'p> {
    id: &'p str,
    model: &'p str,
    model_params: &'p serde_json::Map<String, serde_json::Value>,
    prepare: Vec<serde_json::Value>,
    complexity: u64,
}

/// The trial every other must beat, and whether it may win (`reference`) or not (`floor`).
struct Baseline<'p> {
    id: &'p str,
    role: BaselineRole,
}

/// The split and every step before it, one cross-validate step per trial fed by the split's
/// train rows, and the select step reading their scores.
fn build(
    base: &PipelineVersion,
    split: &str,
    metric: &str,
    trials: &[Trial],
    baseline: Baseline,
    not_compared: Vec<serde_json::Value>,
) -> Result<Comparison, ResolveError> {
    // Folds must keep what the split keeps apart: time order, or whole groups (ADR-0047).
    let (fold_by, repeats) = fold_by(step_of(base, split)?)?;
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
    let mut complexity = serde_json::Map::new();
    let mut scores = Vec::new();
    for trial in trials {
        let step = format!("cv_{}", trial.id);
        let mut params = serde_json::Map::new();
        params.insert("candidate".into(), json!(trial.model));
        params.insert("candidate_params".into(), json!(trial.model_params));
        params.insert("folds".into(), json!(FOLDS));
        params.insert("repeats".into(), json!(repeats));
        params.insert("seed".into(), json!(SEED));
        params.insert("metric".into(), json!(metric));
        params.insert("prepare".into(), json!(trial.prepare));
        params.extend(fold_by.clone());
        nodes.push(parse(
            &json!({ "id": step, "operator": CROSS_VALIDATE, "params": params }).to_string(),
        )?);
        edges.push(edge(&format!("{split}.train"), &format!("{step}.train"))?);
        scores.push(edge(
            &format!("{step}.scores"),
            &format!("{SELECT_NODE}.{}", trial.id),
        )?);
        complexity.insert(trial.id.to_owned(), json!(trial.complexity));
    }
    edges.extend(scores);
    nodes.push(parse(
        &json!({
            "id": SELECT_NODE, "operator": SELECT,
            "params": {
                "trials": trials.iter().map(|t| t.id).collect::<Vec<_>>(),
                "baseline": baseline.id, "baseline_role": baseline.role,
                "metric": metric, "complexity": complexity, "not_compared": not_compared
            }
        })
        .to_string(),
    )?);
    Ok(Comparison { nodes, edges })
}

/// Fixed before any score is seen (ADR-0044).
fn metric_of(task: TaskType) -> Result<&'static str, ResolveError> {
    match task {
        TaskType::Classification => Ok("balanced_accuracy"),
        TaskType::Regression => Ok("rmse"),
        other => Err(ResolveError::Selection(format!(
            "a {other} question has no metric to compare by"
        ))),
    }
}

/// The one model whose train rows come through `subject` from a split, and that walk.
fn model_after<'p, 'a>(
    base: &'p PipelineVersion,
    subject: &str,
    is_split: &impl Fn(&Node) -> bool,
    keeps_train: &impl Fn(&Node) -> bool,
    operator_of: &impl Fn(&str) -> Option<&'a Operator>,
) -> Result<(&'p Node, Vec<&'p str>), ResolveError> {
    let mut found = Vec::new();
    for node in &base.nodes {
        let is_model = operator_of(node.operator.as_str()).is_some_and(|o| o.model.is_some());
        if !is_model {
            continue;
        }
        // A model whose rows do not trace to a split is not one this step prepares for.
        let Ok(chain) = train_rows_chain(base, node.id.as_str(), is_split, keeps_train) else {
            continue;
        };
        if chain[..chain.len() - 1].contains(&subject) {
            found.push((node, chain));
        }
    }
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(ResolveError::NothingToCompare(format!(
            "step {subject} is not between a split and a model on the train rows"
        ))),
        n => Err(ResolveError::NothingToCompare(format!(
            "step {subject} prepares the train rows of {n} models; it is compared for one model at a time"
        ))),
    }
}

/// What an alternative puts in its step's place within each fold: another step, or nothing
/// when it removes the step. Err says why it cannot be refit within each fold.
fn measured_step<'a>(
    rule: &MethodologyRule,
    alternative: &MethodologyAlternative,
    operator_of: &impl Fn(&str) -> Option<&'a Operator>,
) -> Result<Option<serde_json::Value>, String> {
    let declared = rule
        .alternatives
        .iter()
        .find(|a| a.id.as_str() == alternative.id.as_str());
    let before_split = declared.is_some_and(|a| {
        a.action
            .placement
            .as_ref()
            .is_some_and(|p| p.as_str() == "before_split")
    });
    if before_split {
        return Err("It acts before the split, on train and test rows together, so it cannot be refit within each fold.".into());
    }
    // A rule's verdict stands whatever effect a proposal carries: what it rejects is not scored.
    let reason = alternative.reason.as_str();
    match alternative.applicability {
        MethodologyAlternativeApplicability::NotApplicable => {
            return Err(format!("Not applicable here: {reason}"));
        }
        MethodologyAlternativeApplicability::NeedsFact => {
            return Err(format!("Needs a fact first: {reason}"));
        }
        MethodologyAlternativeApplicability::Applicable => {}
    }
    match &alternative.effect {
        None => Err("The rule builds no step for it yet.".into()),
        Some(GraphEffect::RemoveNode { .. }) => Ok(None),
        Some(GraphEffect::ReplaceNode {
            operator, params, ..
        }) => {
            let fits =
                operator_of(operator.as_str()).is_some_and(|o| o.fits_on_train == Some(true));
            if !fits {
                return Err(format!(
                    "{} does not fit on the train rows and keep train and test apart, so it cannot be refit within each fold.",
                    operator.as_str()
                ));
            }
            Ok(Some(json!({ "operator": operator, "params": params })))
        }
    }
}

fn step_of<'p>(base: &'p PipelineVersion, id: &str) -> Result<&'p Node, ResolveError> {
    base.nodes
        .iter()
        .find(|n| n.id.as_str() == id)
        .ok_or_else(|| ResolveError::UnknownNode(id.to_owned()))
}

fn as_prepared(step: &Node) -> Result<serde_json::Value, ResolveError> {
    Ok(json!({ "operator": step.operator, "params": step.params }))
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
        if split.params.contains_key("group_column") {
            return Err(ResolveError::Selection(format!(
                "split step {} keeps entities apart over time, which time-ordered folds would mix; such a flow cannot be compared yet",
                split.id.as_str()
            )));
        }
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
