//! The methodology review (ADR-0059): every active rule that fits the question, with the
//! step it decides, in decision order, and each one's status.

use serde_json::json;
use sprisk_contracts::{
    DecisionProposal, GraphEffect, MethodologyAlternativeApplicability, MethodologyDecision,
    MethodologyReviewItem, MethodologyReviewStatus, MethodologyRule, MethodologyRuleStatus,
    MethodologyStage, Node, Operator, PipelineVersion, RuleActionType, TaskType, parse,
};

use crate::{
    ResolveError, RuleCatalog, catalog::decides, compare::upstream, facts, reopened_stage,
};

/// Decisions that shape the table a split reads, in order: a join adds the other table's
/// columns, identifiers are left out, then markup is stripped from the text left. Rules
/// measuring that table wait for them, so they see it final (ADR-0059): duplicate rows, say,
/// differ by an identifier, and "Caf&eacute;" and "Café" are one spelling.
pub const TABLE_SHAPE: [&str; 3] = ["data.join_sources", "data.column_roles", "data.html_text"];

/// Order of the decisions that shape a model's input columns:
/// - words first, so no rule takes free text for categories (ADR-0058);
/// - date parts, whose gaps become gaps in numbers that can be filled;
/// - rare categories, which keep a gap as its own category;
/// - gaps filled, since encoding refuses gaps;
/// - encoding last: first, it would leave out columns grouping makes small enough to encode.
pub const INPUT_SHAPE: [&str; 5] = [
    "features.text_representation",
    "features.date_parts",
    "features.rare_categories",
    "cleaning.missingness_strategy",
    "features.encoding_strategy",
];

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

/// Whether `later` must wait for `earlier`: it measures train rows, and `earlier` decides a
/// step strictly upstream of `later`'s. The split is a method's decision, made in the walk's
/// look before any rule acts (ADR-0063). A rule reading cross-validation
/// results also waits for the rules of its own step that do not (ADR-0059): they may change
/// what was compared. A rule measuring the table a step reads waits for the rules of that step
/// that shape it (`TABLE_SHAPE`), and the rules shaping a model's inputs go in
/// `INPUT_SHAPE` order.
pub fn comes_after(pipeline: &PipelineVersion, later: &Planned, earlier: &Planned) -> bool {
    let same_step = matches!((later.subject, earlier.subject), (Some(l), Some(e)) if l.id == e.id);
    let shape = |p: &Planned| {
        TABLE_SHAPE
            .iter()
            .position(|d| *d == p.rule.decides.as_str())
    };
    if same_step
        && facts::needs_input_rows(reads(later))
        && let Some(earlier_at) = shape(earlier)
    {
        return match shape(later) {
            // A rule measuring the table waits for every rule shaping it.
            None => true,
            // Shaping rules go in TABLE_SHAPE order.
            Some(later_at) => later_at > earlier_at,
        };
    }
    let input_at = |p: &Planned| {
        INPUT_SHAPE
            .iter()
            .position(|d| *d == p.rule.decides.as_str())
    };
    if same_step && let (Some(later_at), Some(earlier_at)) = (input_at(later), input_at(earlier)) {
        return later_at > earlier_at;
    }
    let results = facts::needs_results(reads(later));
    if !results && !facts::needs_train_rows(reads(later)) {
        return false;
    }
    match (later.subject, earlier.subject) {
        (Some(later_step), Some(earlier_step)) if later_step.id == earlier_step.id => {
            results && !facts::needs_results(reads(earlier))
        }
        (Some(later_step), Some(earlier_step)) => {
            upstream(pipeline, later_step.id.as_str()).contains(earlier_step.id.as_str())
        }
        _ => false,
    }
}

fn reads<'a>(planned: &'a Planned) -> impl Iterator<Item = &'a str> {
    planned.rule.reads.iter().map(|r| r.as_str())
}

/// The review item for `planned`.
pub fn item(planned: &Planned, outcome: Outcome) -> Result<MethodologyReviewItem, ResolveError> {
    let (status, reason, recommended) = match outcome {
        Outcome::Proposed { proposal, decided } => {
            verdict(&proposal, planned.rule, planned.subject, decided)?
        }
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
        if status == MethodologyReviewStatus::Reopen {
            built["reopens"] = json!(reopens(planned.rule, &recommended));
        }
        built["recommended_alternative_id"] = json!(recommended);
    }
    Ok(parse(&built.to_string())?)
}

/// Settled when the step carries this rule's decision, or the recommended alternative
/// changes nothing; asks when it needs a fact; else a proposal.
fn verdict(
    proposal: &DecisionProposal,
    rule: &MethodologyRule,
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
    } else if reopens(rule, id).is_some() {
        MethodologyReviewStatus::Reopen
    } else if changes_nothing(chosen.effect.as_ref(), subject, settings_of(rule, id)) {
        MethodologyReviewStatus::Settled
    } else {
        MethodologyReviewStatus::Proposal
    };
    Ok((status, chosen.reason.to_string(), recommended))
}

/// The stage the rule's alternative `id` reopens, when its action is `reopen` (ADR-0059).
fn reopens(rule: &MethodologyRule, id: &str) -> Option<MethodologyStage> {
    rule.alternatives
        .iter()
        .find(|a| a.id.as_str() == id && a.action.type_ == RuleActionType::Reopen)
        .and_then(|a| reopened_stage(&a.action.params))
}

/// The settings a person may adjust on the route `id` (its `settings_schema` properties), such
/// as the test share of a split, each with its schema. They are not part of what the rule decides.
fn settings_of<'r>(
    rule: &'r MethodologyRule,
    id: &str,
) -> Option<&'r serde_json::Map<String, serde_json::Value>> {
    rule.alternatives
        .iter()
        .find(|a| a.id.as_str() == id)
        .and_then(|a| a.settings_schema.get("properties"))
        .and_then(serde_json::Value::as_object)
}

/// No effect, or a replacement by the operator the step already runs, with the same params
/// apart from the route's `settings`, whose values the step has within their allowed range.
fn changes_nothing(
    effect: Option<&GraphEffect>,
    subject: Option<&Node>,
    settings: Option<&serde_json::Map<String, serde_json::Value>>,
) -> bool {
    let is_setting = |name: &str| settings.is_some_and(|s| s.contains_key(name));
    match (effect, subject) {
        (None, _) => true,
        (
            Some(GraphEffect::ReplaceNode {
                operator, params, ..
            }),
            Some(node),
        ) => {
            let decided = |params: &serde_json::Map<String, serde_json::Value>| {
                params
                    .iter()
                    .filter(|(name, _)| !is_setting(name))
                    .map(|(name, value)| (name.clone(), value.clone()))
                    .collect::<std::collections::BTreeMap<_, _>>()
            };
            let allowed = settings.into_iter().flatten().all(|(name, schema)| {
                node.params
                    .get(name)
                    .is_none_or(|value| jsonschema::is_valid(schema, value))
            });
            operator.as_str() == node.operator.as_str()
                && decided(params) == decided(&node.params)
                && allowed
        }
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
            | MethodologyReviewStatus::Reopen
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

/// Whether `decision`, carried by `step`, settles `subject`: the step's own decision does,
/// and an upstream step's only when it was made for `subject`. A rule that adds a step records
/// its decision there, for the subject; a person's own step decided for itself says nothing
/// about what else reaches the subject.
pub fn decided_for(subject: &str, step: &str, decision: &MethodologyDecision) -> bool {
    step == subject || decision.subject_node_id.as_str() == subject
}

/// Whether `subject`, or a step it reads from, carries a decision `by_rule` made. A rule that
/// adds a step records its decision on that step, not on the subject it is anchored to.
pub fn carries_decision(
    pipeline: &PipelineVersion,
    subject: &str,
    by_rule: impl Fn(&Node) -> bool,
) -> bool {
    let feeding = upstream(pipeline, subject);
    pipeline
        .nodes
        .iter()
        .any(|n| feeding.contains(n.id.as_str()) && by_rule(n))
}

/// Whether a split feeds `step`, directly or through other steps.
pub fn after_a_split(
    pipeline: &PipelineVersion,
    step: &str,
    is_split: impl Fn(&Node) -> bool,
) -> bool {
    carries_decision(pipeline, step, |n| n.id.as_str() != step && is_split(n))
}
