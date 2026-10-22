//! The methodology review (ADR-0059): every active rule that fits the question, with the
//! step it decides, in decision order, and each one's status.

use serde_json::{Value, json};
use sprisk_contracts::{
    DecisionProposal, MethodologyReviewItem, MethodologyReviewStatus, MethodologyRule,
    MethodologyRuleStatus, Node, PipelineVersion, parse,
};

use crate::{ResolveError, RuleCatalog, compare::upstream, facts};

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
) -> Vec<Planned<'a>> {
    let mut pending = Vec::new();
    for rule in catalog
        .rules()
        .filter(|r| r.status == MethodologyRuleStatus::Active)
    {
        let subjects: Vec<&Node> = pipeline
            .nodes
            .iter()
            .filter(|n| decides_step(rule, n.operator.as_str()))
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
        // `comes_after` never holds both ways: the split rule reads no train rows, and
        // upstream is strict on an acyclic flow. So some item is always free; take the first.
        let free = pending
            .iter()
            .position(|p| !pending.iter().any(|q| comes_after(pipeline, p, q)))
            .unwrap_or(0);
        ordered.push(pending.remove(free));
    }
    ordered
}

fn decides_step(rule: &MethodologyRule, operator: &str) -> bool {
    let name = operator.split('@').next().unwrap_or_default();
    rule.applies_to.iter().any(|a| a.as_str() == name)
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
        Outcome::NeedsRun(why) => ("needs_run", why, None),
        Outcome::NotApplicable(why) => ("not_applicable", why, None),
        Outcome::Waiting { on } => (
            "waiting",
            format!("Waits for {on}, which is still open."),
            None,
        ),
        Outcome::NoSubject => {
            let operators: Vec<&str> = planned.rule.applies_to.iter().map(|a| a.as_str()).collect();
            let why = format!("No step runs {} yet.", operators.join(" or "));
            ("no_subject", why, None)
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
) -> Result<(&'static str, String, Option<String>), ResolveError> {
    let proposal = serde_json::to_value(proposal)?;
    let recommended = proposal["recommended_alternative_id"]
        .as_str()
        .map(str::to_owned);
    if decided {
        return Ok((
            "settled",
            "The step carries the decision applied from this rule.".into(),
            recommended,
        ));
    }
    let Some(id) = recommended.as_deref() else {
        let shortlist: Vec<&str> = proposal["shortlist"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        return Ok((
            "proposal",
            format!("Compare the shortlist: {}.", shortlist.join(", ")),
            None,
        ));
    };
    let alternatives = proposal["alternatives"].as_array().into_iter().flatten();
    let chosen = alternatives
        .clone()
        .find(|a| a["id"] == id)
        .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
    let reason = chosen["reason"].as_str().unwrap_or_default().to_owned();
    let status = if chosen["applicability"] == "needs_fact" {
        "needs_fact"
    } else if changes_nothing(&chosen["effect"], subject) {
        "settled"
    } else {
        "proposal"
    };
    Ok((status, reason, recommended))
}

/// No effect, or a replacement by the operator and params the step already has.
fn changes_nothing(effect: &Value, subject: Option<&Node>) -> bool {
    match (effect["kind"].as_str(), subject) {
        (None, _) => true,
        (Some("replace_node"), Some(node)) => {
            effect["operator"] == node.operator.as_str() && effect["params"] == json!(node.params)
        }
        _ => false,
    }
}

/// What the first open item before `at` that `at` must come after decides, if any.
pub fn waits_on<'a>(
    pipeline: &PipelineVersion,
    planned: &'a [Planned],
    at: usize,
    open: &[bool],
) -> Option<&'a str> {
    let later = planned.get(at)?;
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
