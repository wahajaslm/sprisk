//! The methodology review (ADR-0059): every active rule that fits the question, with the
//! step it decides, in decision order, and each one's status.

use serde_json::json;
use sprisk_contracts::{
    DecisionProposal, GraphEffect, MethodologyAlternativeApplicability, MethodologyReviewItem,
    MethodologyReviewStatus, MethodologyRule, MethodologyRuleStatus, Node, Operator,
    PipelineVersion, TaskType, parse,
};

use crate::{ResolveError, RuleCatalog, catalog::decides, compare::upstream, facts};

/// What the split rule decides. A rule that measures train rows needs it decided first.
pub const SPLIT_DECISION: &str = "split.method";

/// One rule and the step it decides; `subject` is `None` when the flow has no such step.
pub struct Planned<'a> {
    pub rule: &'a MethodologyRule,
    pub subject: Option<&'a Node>,
}

/// What became of one planned rule.
pub enum Outcome {
    /// The rule decided; `decided` says the step already carries a decision of this rule.
    Proposed {
        proposal: Box<DecisionProposal>,
        decided: bool,
    },
    /// It measures train rows the flow has not produced yet.
    NeedsRun(String),
    /// The rule refused this step, with its reason.
    NotApplicable(String),
    /// An earlier open item, which decides `on`, changes what it reads.
    Waiting { on: String },
    /// The flow has no step for it.
    NoSubject,
}

/// Each active rule once per step it decides, or once with no step when `fits` says it fits
/// the question, in decision order: a rule that measures train rows comes after the split
/// rule and after every rule deciding a step upstream of its own. Ties go by stage, then id.
pub fn plan<'a>(
    catalog: &'a RuleCatalog,
    pipeline: &'a PipelineVersion,
    fits: impl Fn(&MethodologyRule) -> bool,
) -> Result<Vec<Planned<'a>>, ResolveError> {
    let mut pending = Vec::new();
    for rule in catalog
        .rules()
        .filter(|r| r.status == MethodologyRuleStatus::Active)
    {
        let subjects: Vec<&Node> = pipeline
            .nodes
            .iter()
            .filter(|n| decides(rule, n.operator.as_str()))
            .collect();
        if subjects.is_empty() && fits(rule) {
            pending.push(Planned {
                rule,
                subject: None,
            });
        }
        pending.extend(subjects.into_iter().map(|subject| Planned {
            rule,
            subject: Some(subject),
        }));
    }
    pending.sort_by_key(|p| {
        (
            p.rule.stage,
            p.rule.id.to_string(),
            p.subject.map(|n| n.id.to_string()),
        )
    });

    let mut ordered = Vec::with_capacity(pending.len());
    while !pending.is_empty() {
        let free = pending
            .iter()
            .position(|p| !pending.iter().any(|q| comes_after(pipeline, p, q)))
            .ok_or_else(|| {
                let stuck: Vec<String> = pending.iter().map(|p| p.rule.id.to_string()).collect();
                ResolveError::Unordered(stuck.join(", "))
            })?;
        ordered.push(pending.remove(free));
    }
    Ok(ordered)
}

/// Whether `later` must wait for `earlier`: it measures train rows, and `earlier` decides
/// the split or a step strictly upstream of `later`'s.
pub fn comes_after(pipeline: &PipelineVersion, later: &Planned, earlier: &Planned) -> bool {
    if !facts::needs_train_rows(later.rule.reads.iter().map(|r| r.as_str())) {
        return false;
    }
    if earlier.rule.decides.as_str() == SPLIT_DECISION {
        return true;
    }
    match (later.subject, earlier.subject) {
        (Some(later), Some(earlier)) => {
            later.id != earlier.id
                && upstream(pipeline, later.id.as_str()).contains(earlier.id.as_str())
        }
        _ => false,
    }
}

/// The review item for `planned`.
pub fn item(planned: &Planned, outcome: Outcome) -> Result<MethodologyReviewItem, ResolveError> {
    let (status, reason, recommended) = match outcome {
        Outcome::Proposed { proposal, decided } => verdict(&proposal, planned.subject, decided)?,
        Outcome::NeedsRun(why) => (MethodologyReviewStatus::NeedsRun, why, None),
        Outcome::NotApplicable(why) => (MethodologyReviewStatus::NotApplicable, why, None),
        Outcome::Waiting { on } => (
            MethodologyReviewStatus::Waiting,
            format!("Waits for {on}, which is still open."),
            None,
        ),
        Outcome::NoSubject => {
            let operators: Vec<&str> = planned.rule.applies_to.iter().map(|a| a.as_str()).collect();
            let why = format!("No step runs {} yet.", operators.join(" or "));
            (MethodologyReviewStatus::NoSubject, why, None)
        }
    };
    let mut built = json!({
        "rule": planned.rule.id,
        "decides": planned.rule.decides,
        "stage": planned.rule.stage,
        "status": status,
        "reason": reason,
    });
    if let Some(subject) = planned.subject {
        built["subject_node_id"] = json!(subject.id);
    }
    if let Some(recommended) = recommended {
        built["recommended_alternative_id"] = json!(recommended);
    }
    Ok(parse(&built.to_string())?)
}

/// Settled when the step carries this rule's decision, or the recommended alternative
/// changes nothing; asks when it needs a fact; else a proposal.
fn verdict(
    proposal: &DecisionProposal,
    subject: Option<&Node>,
    decided: bool,
) -> Result<(MethodologyReviewStatus, String, Option<String>), ResolveError> {
    let recommended = proposal
        .recommended_alternative_id
        .as_ref()
        .map(|r| r.as_str().to_owned());
    if decided {
        return Ok((
            MethodologyReviewStatus::Settled,
            "The step carries the decision applied from this rule.".into(),
            recommended,
        ));
    }
    let Some(id) = recommended.as_deref() else {
        let shortlist: Vec<&str> = proposal.shortlist.iter().map(|s| s.as_str()).collect();
        return Ok((
            MethodologyReviewStatus::Proposal,
            format!("Compare the shortlist: {}.", shortlist.join(", ")),
            None,
        ));
    };
    let chosen = proposal
        .alternatives
        .iter()
        .find(|a| a.id.as_str() == id)
        .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
    let status = if chosen.applicability == MethodologyAlternativeApplicability::NeedsFact {
        MethodologyReviewStatus::NeedsFact
    } else if changes_nothing(chosen.effect.as_ref(), subject) {
        MethodologyReviewStatus::Settled
    } else {
        MethodologyReviewStatus::Proposal
    };
    Ok((status, chosen.reason.to_string(), recommended))
}

/// No effect, or a replacement by the operator and params the step already has.
fn changes_nothing(effect: Option<&GraphEffect>, subject: Option<&Node>) -> bool {
    match (effect, subject) {
        (None, _) => true,
        (
            Some(GraphEffect::ReplaceNode {
                operator, params, ..
            }),
            Some(node),
        ) => operator.as_str() == node.operator.as_str() && *params == node.params,
        _ => false,
    }
}

/// What the first open item before `at` that `at` must come after decides, if any. A rule
/// with no step waits for nothing: it has nothing to decide yet.
pub fn waits_on<'a>(
    pipeline: &PipelineVersion,
    planned: &'a [Planned],
    at: usize,
    open: &[bool],
) -> Option<&'a str> {
    let later = planned.get(at)?;
    later.subject?;
    planned[..at]
        .iter()
        .zip(open)
        .find(|(earlier, open)| **open && comes_after(pipeline, later, earlier))
        .map(|(earlier, _)| earlier.rule.decides.as_str())
}

/// Whether an item's status leaves something to do before the map is complete.
pub fn is_open(item: &MethodologyReviewItem) -> bool {
    matches!(
        item.status,
        MethodologyReviewStatus::Proposal
            | MethodologyReviewStatus::NeedsFact
            | MethodologyReviewStatus::NeedsRun
            | MethodologyReviewStatus::Waiting
    )
}

/// The indexes of the open items that wait for nothing: what to do next.
pub fn next(items: &[MethodologyReviewItem]) -> Vec<usize> {
    items
        .iter()
        .enumerate()
        .filter(|(_, item)| is_open(item) && item.status != MethodologyReviewStatus::Waiting)
        .map(|(at, _)| at)
        .collect()
}

/// Whether `rule` fits a `task` question: one of the steps it decides is registered and is
/// not a model, or is a model for that task.
pub fn fits_task<'a>(
    rule: &MethodologyRule,
    task: TaskType,
    mut operators: impl Iterator<Item = &'a Operator>,
) -> bool {
    operators.any(|o| {
        decides(rule, o.id.as_str()) && o.model.as_ref().is_none_or(|m| m.tasks.contains(&task))
    })
}
