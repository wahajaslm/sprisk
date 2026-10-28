//! The steps that compare a shortlist of models (ADR-0044, ADR-0046), or the ways of doing one
//! preparation step (ADR-0050): the split and every step before it, one cross-validate step
//! per trial fed by the split's train rows, and one select step reading their scores. Nothing
//! reads the split's other outputs.

use std::collections::HashSet;

use petgraph::graph::DiGraph;
use petgraph::visit::Dfs;
use serde_json::json;
use sprisk_contracts::{
    BaselineRole, DecisionProposal, Edge, GraphEffect, Guardrail, Node, Operator, OperatorRole,
    PipelineVersion, PipelineVersionId, PortKind, SelectionMetric, SplitFolds, StudyStrategy,
    TaskType, parse,
};

use crate::decision::train_rows_chain;
use crate::search;
use crate::{Defaults, ResolveError};
use sprisk_registry::Registry;

/// Whether `node` splits rows, by its operator's role (ADR-0064).
fn is_split(registry: &Registry, node: &Node) -> bool {
    registry
        .get(node.operator.as_str())
        .is_some_and(|o| o.role == Some(OperatorRole::Split))
}

/// Folds, repeats and seed of every comparison, recorded in each cross-validate step's params:
/// at most ten shuffles into five folds, for the corrected repeated k-fold t-test (ADR-0050).
/// A large train set is shuffled fewer times; the decision records how many ran (ADR-0064).
pub const FOLDS: u64 = 5;
pub const REPEATS: u64 = 10;
pub const SEED: u64 = 0;
/// Inner folds of a study's trial: they only rank settings, so 3 bounds the cost (ADR-0052).
pub const INNER_FOLDS: u64 = 3;
/// The select step of every comparison; its `decision` output is the SelectionDecision.
pub const SELECT_NODE: &str = "select_model";

#[derive(Debug)]
pub struct Comparison {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

/// The models a comparison compares on one model step, from a rule's shortlist proposal or a
/// compared method's options (ADR-0063 D3), and the options left off, each with why.
pub struct Candidates<'c> {
    pub subject: &'c str,
    pub models: Vec<Candidate<'c>>,
    pub left_out: Vec<(String, String)>,
}

/// One model a comparison fits: its operator and its settings on the model step.
pub struct Candidate<'c> {
    pub id: &'c str,
    pub operator: &'c str,
    pub params: &'c serde_json::Map<String, serde_json::Value>,
}

impl<'p> Candidates<'p> {
    /// `proposal`'s shortlist: each shortlisted alternative replaces the model step.
    pub fn of_proposal(proposal: &'p DecisionProposal) -> Result<Self, ResolveError> {
        if proposal.shortlist.is_empty() {
            return Err(ResolveError::Selection(format!(
                "proposal {} has no shortlist to compare",
                proposal.id.as_str()
            )));
        }
        let models = proposal
            .shortlist
            .iter()
            .map(|id| {
                let (operator, params) = candidate(proposal, id.as_str())?;
                Ok(Candidate {
                    id: id.as_str(),
                    operator,
                    params,
                })
            })
            .collect::<Result<_, ResolveError>>()?;
        let left_out = proposal
            .alternatives
            .iter()
            .filter(|a| {
                !proposal
                    .shortlist
                    .iter()
                    .any(|s| s.as_str() == a.id.as_str())
            })
            .map(|a| (a.id.to_string(), a.reason.to_string()))
            .collect();
        Ok(Self {
            subject: proposal.subject_node_id.as_str(),
            models,
            left_out,
        })
    }
}

/// The comparison of `candidates` on `base`, its flow. The registry gives each candidate's
/// operator, so the baseline is the one model with no family, and the steps the comparison
/// builds, by role.
pub fn comparison(
    base: &PipelineVersion,
    candidates: &Candidates,
    scoring: Scoring,
    keeps_train: impl Fn(&Node) -> bool,
    registry: &Registry,
) -> Result<Comparison, ResolveError> {
    let operator_of = |operator: &str| registry.get(operator);
    let is_split = |n: &Node| is_split(registry, n);
    let shortlist = shortlist(
        base,
        candidates,
        scoring,
        is_split,
        keeps_train,
        &operator_of,
    )?;
    build(base, &shortlist, &Study::default(), registry)
}

/// What a study asks of a comparison (ADR-0052).
pub struct StudySearch<'s> {
    pub strategy: StudyStrategy,
    pub seed: u64,
    pub max_trials: u64,
    pub guardrails: &'s [Guardrail],
    /// Earlier comparisons of the same version and step, recorded in the decision.
    pub earlier_looks: &'s [PipelineVersionId],
}

/// A study of `candidates` (ADR-0052): a model whose manifest declares a search gets one
/// trial per setting the strategy lists, tuned on inner folds; any other gets one trial at
/// the flow's settings. Every trial scores the recall each guardrail names.
pub fn study_comparison(
    base: &PipelineVersion,
    candidates: &Candidates,
    scoring: Scoring,
    keeps_train: impl Fn(&Node) -> bool,
    registry: &Registry,
    asked: &StudySearch,
) -> Result<Comparison, ResolveError> {
    let operator_of = |operator: &str| registry.get(operator);
    let is_split = |n: &Node| is_split(registry, n);
    let mut shortlist = shortlist(
        base,
        candidates,
        scoring,
        is_split,
        keeps_train,
        &operator_of,
    )?;
    let searches: Vec<_> = shortlist
        .trials
        .iter()
        .map(|t| {
            operator_of(&t.model)
                .and_then(|o| o.model.as_ref())
                .map(|m| m.search.clone())
                .unwrap_or_default()
        })
        .collect();
    let sizes: Vec<usize> = searches
        .iter()
        .filter(|s| !s.is_empty())
        .map(|s| search::grid(s).len())
        .collect();
    let one_trial = searches.len() - sizes.len();
    let mut counts =
        search::trials_per_candidate(asked.strategy, asked.max_trials, one_trial, &sizes)?
            .into_iter();
    let mut study = Study {
        recall_of: asked
            .guardrails
            .iter()
            .map(|g| g.label.to_string())
            .collect(),
        guardrails: asked.guardrails.to_vec(),
        earlier_looks: asked.earlier_looks.to_vec(),
        ..Study::default()
    };
    let mut trials = Vec::new();
    for (candidate, space) in shortlist.trials.drain(..).zip(searches) {
        if space.is_empty() {
            trials.push(candidate);
            continue;
        }
        let n = counts.next().ok_or_else(|| {
            ResolveError::Selection(format!("no trial count for {}", candidate.id))
        })?;
        let points = match asked.strategy {
            StudyStrategy::Grid => search::grid(&space),
            StudyStrategy::Random => search::random(&space, asked.seed, n),
        };
        let mut group = Vec::new();
        for (k, point) in points.into_iter().enumerate() {
            let id = format!("{}_t{}", candidate.id, k + 1);
            let mut model_params = candidate.model_params.clone();
            model_params.extend(point.clone());
            study
                .settings
                .insert(id.clone(), serde_json::Value::Object(point));
            group.push(id.clone());
            trials.push(Trial {
                id,
                model_params,
                inner_folds: true,
                ..candidate.clone()
            });
        }
        study
            .complexity_of
            .push((candidate.id.clone(), candidate.complexity));
        study.tuned.insert(candidate.id, json!(group));
    }
    shortlist.trials = trials;
    build(base, &shortlist, &study, registry)
}

/// The shortlist's trials at the flow's settings, and what every comparison of it shares.
struct Shortlist<'p> {
    split: &'p str,
    metric: &'static str,
    trials: Vec<Trial>,
    baseline: Baseline,
    not_compared: Vec<serde_json::Value>,
    look: i64,
}

fn shortlist<'p, 'a>(
    base: &'p PipelineVersion,
    candidates: &Candidates,
    scoring: Scoring,
    is_split: impl Fn(&Node) -> bool,
    keeps_train: impl Fn(&Node) -> bool,
    operator_of: &impl Fn(&str) -> Option<&'a Operator>,
) -> Result<Shortlist<'p>, ResolveError> {
    let subject = candidates.subject;
    let metric = metric_of(scoring, step_of(base, subject)?)?;
    let chain = train_rows_chain(base, subject, is_split, keeps_train)?;
    let (split, between) = chain
        .split_last()
        .ok_or_else(|| ResolveError::NotTrainRows("no split feeds the model".into()))?;
    words_as_the_flow_reads(base, subject, between, operator_of)?;
    // Every step between the split and the model fits on train (the walk above refuses any
    // other), so each fold refits them, in flow order, before the candidate (ADR-0050).
    let prepare = between
        .iter()
        .rev()
        .map(|id| as_prepared(step_of(base, id)?))
        .collect::<Result<Vec<_>, ResolveError>>()?;

    let mut trials = Vec::new();
    let mut baselines = Vec::new();
    for &Candidate {
        id,
        operator,
        params,
    } in &candidates.models
    {
        let model = operator_of(operator)
            .ok_or_else(|| ResolveError::UnknownOperator(operator.to_owned()))?
            .model
            .as_ref()
            .ok_or_else(|| ResolveError::Selection(format!("{operator} is not a model")))?;
        if model.family.is_none() {
            baselines.push(id);
        }
        // The one-SE rule ranks candidates by it (ADR-0050); the registry requires it.
        let complexity = model
            .complexity
            .ok_or_else(|| ResolveError::Selection(format!("{operator} declares no complexity")))?;
        trials.push(Trial {
            id: id.to_owned(),
            model: operator.to_owned(),
            model_params: params.clone(),
            prepare: prepare.clone(),
            complexity,
            inner_folds: false,
        });
    }
    let [baseline] = baselines[..] else {
        return Err(ResolveError::Selection(format!(
            "a comparison needs exactly one baseline, a model with no family, on the shortlist; found {}",
            baselines.len()
        )));
    };
    let not_compared = candidates
        .left_out
        .iter()
        .map(
            |(id, reason)| json!({ "id": id, "reason": format!("Not on the shortlist: {reason}") }),
        )
        .collect();
    Ok(Shortlist {
        split,
        metric,
        trials,
        baseline: Baseline {
            id: baseline.to_owned(),
            role: BaselineRole::Floor,
        },
        not_compared,
        look: scoring.look,
    })
}

/// One cross-validate step: `model` refit after `prepare` on each fold; with `inner_folds`,
/// a study's trial that its candidate is tuned over.
#[derive(Clone)]
struct Trial {
    id: String,
    model: String,
    model_params: serde_json::Map<String, serde_json::Value>,
    prepare: Vec<serde_json::Value>,
    complexity: u64,
    inner_folds: bool,
}

/// The trial every other must beat, and whether it may win (`reference`) or not (`floor`).
struct Baseline {
    id: String,
    role: BaselineRole,
}

/// What a study adds to its select step; empty for any other comparison.
#[derive(Default)]
struct Study {
    tuned: serde_json::Map<String, serde_json::Value>,
    settings: serde_json::Map<String, serde_json::Value>,
    /// A tuned candidate's complexity; its trials are not candidates themselves.
    complexity_of: Vec<(String, u64)>,
    recall_of: Vec<String>,
    guardrails: Vec<Guardrail>,
    earlier_looks: Vec<PipelineVersionId>,
}

/// The split and every step before it, one cross-validate step per trial fed by the split's
/// train rows, and the select step reading their scores.
fn build(
    base: &PipelineVersion,
    shortlist: &Shortlist,
    study: &Study,
    registry: &Registry,
) -> Result<Comparison, ResolveError> {
    let defaults = Defaults::of(registry)?;
    let Shortlist {
        split,
        metric,
        trials,
        baseline,
        not_compared,
        look,
    } = shortlist;
    let split = *split;
    // Folds must keep what the split keeps apart: time order, or whole groups (ADR-0050).
    let split_step = step_of(base, split)?;
    let (fold_by, repeats) = fold_by(split_step, registry.get(split_step.operator.as_str()))?;
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
        if trial.inner_folds {
            params.insert("inner_folds".into(), json!(INNER_FOLDS));
        }
        if !study.recall_of.is_empty() {
            params.insert("recall_of".into(), json!(study.recall_of));
        }
        nodes.push(parse(
            &json!({ "id": step, "operator": defaults.cross_validate, "params": params })
                .to_string(),
        )?);
        edges.push(edge(&format!("{split}.train"), &format!("{step}.train"))?);
        scores.push(edge(
            &format!("{step}.scores"),
            &format!("{SELECT_NODE}.{}", trial.id),
        )?);
        if !trial.inner_folds {
            complexity.insert(trial.id.clone(), json!(trial.complexity));
        }
    }
    for (candidate, of) in &study.complexity_of {
        complexity.insert(candidate.clone(), json!(of));
    }
    edges.extend(scores);
    let mut select = json!({
        "trials": trials.iter().map(|t| &t.id).collect::<Vec<_>>(),
        "baseline": baseline.id, "baseline_role": baseline.role,
        "metric": metric, "complexity": complexity, "not_compared": not_compared,
        "looks": look
    });
    if !study.tuned.is_empty() {
        select["tuned"] = json!(study.tuned);
        select["settings"] = json!(study.settings);
    }
    if !study.guardrails.is_empty() {
        select["guardrails"] = json!(study.guardrails);
    }
    if !study.earlier_looks.is_empty() {
        select["earlier_looks"] = json!(study.earlier_looks);
    }
    nodes.push(parse(
        &json!({ "id": SELECT_NODE, "operator": defaults.select, "params": select }).to_string(),
    )?);
    Ok(Comparison { nodes, edges })
}

/// One cross-validate step of a comparison: a candidate at one set of settings (ADR-0052).
#[derive(Debug, PartialEq)]
pub struct TrialStep<'p> {
    pub node_id: &'p str,
    pub candidate: &'p str,
    pub operator: &'p str,
    /// The searched settings; empty for a trial at the flow's settings.
    pub settings: serde_json::Map<String, serde_json::Value>,
}

/// The trials of `comparison`, in the order its select step lists them.
pub fn trial_steps(comparison: &PipelineVersion) -> Result<Vec<TrialStep<'_>>, ResolveError> {
    let select = step_of(comparison, SELECT_NODE)?;
    let ids = select
        .params
        .get("trials")
        .and_then(|t| t.as_array())
        .ok_or_else(|| ResolveError::Selection(format!("{SELECT_NODE} lists no trials")))?;
    let tuned = select.params.get("tuned").and_then(|t| t.as_object());
    let settings = select.params.get("settings").and_then(|s| s.as_object());
    ids.iter()
        .map(|id| {
            let trial = id
                .as_str()
                .ok_or_else(|| ResolveError::Selection(format!("trial {id} is not an id")))?;
            let node = step_of(comparison, &format!("cv_{trial}"))?;
            let operator = node
                .params
                .get("candidate")
                .and_then(|c| c.as_str())
                .ok_or_else(|| {
                    ResolveError::Selection(format!("{} names no candidate", node.id.as_str()))
                })?;
            let candidate = tuned
                .and_then(|t| {
                    t.iter()
                        .find(|(_, group)| group.as_array().is_some_and(|g| g.contains(id)))
                })
                .map_or(trial, |(candidate, _)| candidate.as_str());
            let settings = settings
                .and_then(|s| s.get(trial))
                .and_then(|s| s.as_object())
                .cloned()
                .unwrap_or_default();
            Ok(TrialStep {
                node_id: node.id.as_str(),
                candidate,
                operator,
                settings,
            })
        })
        .collect()
}

/// What a comparison scores by (ADR-0059): the question's task, and the metric a person
/// stated with the success bar, if any. `look` is which look at the folds it is, counting it,
/// which its select step reports (ADR-0063 D4).
#[derive(Clone, Copy, Debug)]
pub struct Scoring {
    pub task: TaskType,
    pub stated: Option<SelectionMetric>,
    pub look: i64,
}

/// Fixed before any score is seen (ADR-0044): expected cost when the `model` step states
/// misclassification costs (ADR-0053), whatever the bar's metric; else the metric a person
/// stated with the success bar (ADR-0059) when it fits the task, else the task's.
fn metric_of(scoring: Scoring, model: &Node) -> Result<&'static str, ResolveError> {
    let Scoring { task, stated, .. } = scoring;
    use SelectionMetric::{BalancedAccuracy, ExpectedCost, Rmse, WeightedF1};
    let costed = model.params.contains_key("costs");
    let refuse = |why: String| Err(ResolveError::Selection(why));
    match (task, costed, stated) {
        // Costs may sit on the model step without being on the question; a bar stated in
        // another metric then asks again at the loop back.
        (TaskType::Classification, true, _) => Ok("expected_cost"),
        (_, true, _) => refuse(format!(
            "costs apply to a classification question, not a {task} one"
        )),
        (TaskType::Classification, false, None | Some(BalancedAccuracy)) => Ok("balanced_accuracy"),
        (TaskType::Classification, false, Some(WeightedF1)) => Ok("weighted_f1"),
        (TaskType::Regression, false, None | Some(Rmse)) => Ok("rmse"),
        // Costs stated, but the threshold rule kept the plain threshold (under time order):
        // the task's metric, and the loop back asks for the bar again.
        (TaskType::Classification, false, Some(ExpectedCost)) => Ok("balanced_accuracy"),
        (TaskType::Classification | TaskType::Regression, false, Some(other)) => {
            refuse(format!("a {task} question is not compared by {other}"))
        }
        (other, false, _) => refuse(format!("a {other} question has no metric to compare by")),
    }
}

/// Each fold refits every step between the split and the model, and the model's input joins
/// the words such a step makes (ADR-0058). So the flow's model must read exactly those words,
/// the `train_words` of a step on its train rows; otherwise the comparison would score a
/// model the flow never fits.
fn words_as_the_flow_reads<'a>(
    base: &PipelineVersion,
    model: &str,
    between: &[&str],
    operator_of: &impl Fn(&str) -> Option<&'a Operator>,
) -> Result<(), ResolveError> {
    let makes_words = |id: &str| -> Result<bool, ResolveError> {
        let operator = step_of(base, id)?.operator.as_str();
        let found =
            operator_of(operator).ok_or_else(|| ResolveError::UnknownOperator(operator.into()))?;
        Ok(found.outputs.iter().any(|p| p.kind == PortKind::Matrix))
    };
    let mut makers = Vec::new();
    for id in between {
        if makes_words(id)? {
            makers.push(*id);
        }
    }
    let reads = base
        .edges
        .iter()
        .find(|e| e.to.as_str() == format!("{model}.words"))
        .map(|e| e.from.step_and_port());
    match (makers.as_slice(), reads) {
        ([], None) => Ok(()),
        ([maker], Some((from, "train_words"))) if *maker == from => Ok(()),
        ([maker], _) => Err(ResolveError::Selection(format!(
            "{model} must read the train_words of {maker}, which each fold makes for it"
        ))),
        ([], Some((from, port))) => Err(ResolveError::Selection(format!(
            "{model} reads {from}.{port}, but no step on its train rows makes words to refit in each fold"
        ))),
        (_, _) => Err(ResolveError::Selection(format!(
            "only one step may make words for {model}; {} do",
            makers.join(", ")
        ))),
    }
}

fn step_of<'p>(base: &'p PipelineVersion, id: &str) -> Result<&'p Node, ResolveError> {
    base.nodes
        .iter()
        .find(|n| n.id.as_str() == id)
        .ok_or_else(|| ResolveError::UnknownNode(id.to_owned()))
}

/// `step` as a fold refits it: its operator's code with its params.
fn as_prepared(step: &Node) -> Result<serde_json::Value, ResolveError> {
    refits_as_flow_runs(step)?;
    Ok(json!({ "operator": step.operator, "params": step.params }))
}

/// A fold refits a step with its operator's code, so a step running its own code (ADR-0028)
/// would be compared as code the flow does not run.
fn refits_as_flow_runs(step: &Node) -> Result<(), ResolveError> {
    if step.code.is_some() {
        return Err(ResolveError::OwnCode {
            step: step.id.as_str().to_owned(),
            operator: step.operator.as_str().to_owned(),
        });
    }
    Ok(())
}

/// How folds must follow `split`, as cross-validate params, and how many repeats that allows,
/// from the folds its manifest declares (ADR-0064): time folds follow its time column and
/// cannot be reshuffled; group folds keep its groups whole; plain folds shuffle rows (ADR-0050).
fn fold_by(
    split: &Node,
    operator: Option<&Operator>,
) -> Result<(serde_json::Map<String, serde_json::Value>, u64), ResolveError> {
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
    match operator.and_then(|o| o.folds) {
        Some(SplitFolds::Time) => {
            if split.params.contains_key("group_column") {
                return Err(ResolveError::Selection(format!(
                    "split step {} keeps entities apart over time, which time-ordered folds would mix; such a flow cannot be compared yet",
                    split.id.as_str()
                )));
            }
            by.insert("time_column".into(), column("time_column")?);
            Ok((by, 1))
        }
        Some(SplitFolds::Group) => {
            by.insert("group_column".into(), column("group_column")?);
            Ok((by, REPEATS))
        }
        Some(SplitFolds::Plain) => Ok((by, REPEATS)),
        None => Err(ResolveError::Selection(format!(
            "split step {} ({}) declares no folds, so models cannot be compared on its train rows",
            split.id.as_str(),
            split.operator.as_str()
        ))),
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
pub(crate) fn upstream<'p>(pipeline: &'p PipelineVersion, step: &str) -> HashSet<&'p str> {
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

pub(crate) fn edge(from: &str, to: &str) -> Result<Edge, ResolveError> {
    Ok(parse(&json!({ "from": from, "to": to }).to_string())?)
}
