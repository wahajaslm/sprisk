//! The engine (ADR-0060): what it builds from a question and its sources, and what it does
//! next with a review of the flow. Pure: the API reads, applies and runs.

use serde_json::{Value, json};
use sprisk_contracts::{
    Edge, MethodologyReview, MethodologyReviewItem, MethodologyReviewStatus, MethodologyRule, Node,
    Origin, PipelineVersion, QuestionVersion, RuleActionType, TaskType, WalkAsk, WalkStopReason,
    parse,
};

use crate::{CatalogError, Defaults, ResolveError, RuleCatalog, compare::SEED};

/// The share of rows the first split holds out. The split rule may change it.
const TEST_FRACTION: f64 = 0.2;

/// What the engine starts a walk with.
#[derive(Debug, PartialEq)]
pub enum Start {
    /// The steps every flow has (ADR-0059): a Load per source, a Split, a baseline model.
    Flow {
        nodes: Vec<Value>,
        edges: Vec<Value>,
    },
    /// Nothing can be built until this is settled.
    Stop {
        reason: WalkStopReason,
        detail: String,
    },
}

/// The first flow for `question` on `sources`. The first source feeds the split, since it
/// holds the rows to predict on; any other has no reader, for the join rule to join.
pub fn start(
    question: &QuestionVersion,
    sources: &[String],
    defaults: &Defaults,
) -> Result<Start, ResolveError> {
    if sources.is_empty() {
        return Err(ResolveError::NoSource);
    }
    let mut nodes = Vec::with_capacity(sources.len() + 2);
    for (at, path) in sources.iter().enumerate() {
        let id = if at == 0 {
            "load".to_owned()
        } else {
            format!("load_{}", at + 1)
        };
        nodes.push(json!({
            "id": id, "operator": defaults.source,
            "params": { "path": path, "format": format_of(path)? },
        }));
    }
    let task = question.task.value;
    if task == TaskType::Exploration {
        return Ok(stop(
            WalkStopReason::Uncovered,
            "The engine walks questions that predict a class or a number; exploration is not walked yet.",
        ));
    }
    if task == TaskType::Undetermined {
        return Ok(stop(
            WalkStopReason::NeedsPerson,
            "State whether the question predicts a class or a number.",
        ));
    }
    let Some(target) = question
        .target
        .as_ref()
        .filter(|t| matches!(t.origin, Origin::Explicit | Origin::Confirmed))
    else {
        return Ok(stop(
            WalkStopReason::NeedsPerson,
            "State or confirm the target column: the engine never guesses or measures one.",
        ));
    };
    nodes.push(json!({
        "id": "split", "operator": defaults.split,
        "params": { "test_fraction": TEST_FRACTION, "seed": SEED },
    }));
    nodes.push(json!({
        "id": MODEL_NODE, "operator": defaults.model,
        "params": { "target": target.value.as_str(), "task": task },
    }));
    let edges = vec![
        json!({ "from": "load.data", "to": "split.data" }),
        json!({ "from": "split.train", "to": format!("{MODEL_NODE}.train") }),
    ];
    Ok(Start::Flow { nodes, edges })
}

/// The model step the engine builds and the rules decide.
pub const MODEL_NODE: &str = "model";
/// The step that scores the model on the test rows, once, when the walk is complete.
pub const SCORE_NODE: &str = "score_test";
/// The featureless baseline fit on the model's train rows, and its score on the same test rows.
pub const TEST_BASELINE_NODE: &str = "test_baseline";
pub const SCORE_BASELINE_NODE: &str = "score_baseline";
/// The step that compares the class shares of the train and test rows. It reads the test
/// labels, so only the final score has it (ADR-0064).
pub const SHARES_NODE: &str = "class_shares";
/// The model settings the baseline shares: what it reads and what its mistakes cost.
const BASELINE_SETTINGS: [&str; 5] = ["target", "task", "features", "exclude", "costs"];

/// `pipeline` with an Evaluate step scoring the model on the test rows (ADR-0060): the rows
/// of the step whose train rows the model fits on, so they are prepared the same way, and the
/// test words of the step whose train words it reads. The featureless baseline is fit on the
/// same train rows and scored on the same test rows beside it, so the score has its floor.
/// Refused when the flow already has it.
pub fn with_test_scoring(
    pipeline: &PipelineVersion,
    defaults: &Defaults,
) -> Result<(Vec<Node>, Vec<Edge>), ResolveError> {
    let refuse = |why: String| ResolveError::NotInsertable(why);
    if let Some(taken) = pipeline.nodes.iter().find(|n| {
        [
            SCORE_NODE,
            TEST_BASELINE_NODE,
            SCORE_BASELINE_NODE,
            SHARES_NODE,
        ]
        .contains(&n.id.as_str())
    }) {
        return Err(refuse(format!(
            "the flow already has a {} step",
            taken.id.as_str()
        )));
    }
    let model = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == MODEL_NODE)
        .ok_or_else(|| ResolveError::UnknownNode(MODEL_NODE.to_owned()))?;
    let feeding = |input: &str| {
        pipeline
            .edges
            .iter()
            .find(|e| e.to.step_and_port() == (MODEL_NODE, input))
            .map(|e| e.from.step_and_port())
    };
    let Some((rows, "train")) = feeding("train") else {
        return Err(refuse(format!("{MODEL_NODE} reads no train rows")));
    };
    let mut edges = vec![
        json!({ "from": format!("{MODEL_NODE}.model"), "to": format!("{SCORE_NODE}.model") }),
        json!({ "from": format!("{rows}.test"), "to": format!("{SCORE_NODE}.test") }),
        json!({ "from": format!("{rows}.train"), "to": format!("{TEST_BASELINE_NODE}.train") }),
        json!({ "from": format!("{TEST_BASELINE_NODE}.model"),
                "to": format!("{SCORE_BASELINE_NODE}.model") }),
        json!({ "from": format!("{rows}.test"), "to": format!("{SCORE_BASELINE_NODE}.test") }),
    ];
    if let Some((words, port)) = feeding("words") {
        if port != "train_words" {
            return Err(refuse(format!(
                "{MODEL_NODE} reads {words}.{port}, not train words"
            )));
        }
        // The baseline reads the same words: a words-only flow leaves its table no columns.
        for (port, to) in [
            ("test_words", SCORE_NODE),
            ("train_words", TEST_BASELINE_NODE),
            ("test_words", SCORE_BASELINE_NODE),
        ] {
            edges.push(json!({ "from": format!("{words}.{port}"), "to": format!("{to}.words") }));
        }
    }
    let params = |name: &str| model.params.get(name).cloned();
    let evaluate = |id: &str| {
        json!({
            "id": id, "operator": defaults.score,
            "params": { "target": params("target"), "task": params("task") },
        })
    };
    let shared: serde_json::Map<String, serde_json::Value> = BASELINE_SETTINGS
        .iter()
        .filter_map(|name| Some(((*name).to_owned(), params(name)?)))
        .collect();
    let baseline = json!({
        "id": TEST_BASELINE_NODE, "operator": defaults.model, "params": shared,
    });
    let mut added = vec![
        evaluate(SCORE_NODE),
        baseline,
        evaluate(SCORE_BASELINE_NODE),
    ];
    if params("task") == Some(json!("classification")) {
        added.push(json!({
            "id": SHARES_NODE, "operator": defaults.score_shares,
            "params": { "target": params("target") },
        }));
        edges
            .push(json!({ "from": format!("{rows}.train"), "to": format!("{SHARES_NODE}.train") }));
        edges.push(json!({ "from": format!("{rows}.test"), "to": format!("{SHARES_NODE}.test") }));
    }
    let mut nodes = pipeline.nodes.clone();
    for node in added {
        nodes.push(parse(&node.to_string())?);
    }
    let mut all = pipeline.edges.clone();
    for e in edges {
        all.push(parse(&e.to_string())?);
    }
    Ok((nodes, all))
}

fn format_of(path: &str) -> Result<&'static str, ResolveError> {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("csv") => Ok("csv"),
        Some("parquet") => Ok("parquet"),
        _ => Err(ResolveError::UnknownFormat(path.to_owned())),
    }
}

fn stop(reason: WalkStopReason, detail: &str) -> Start {
    Start::Stop {
        reason,
        detail: detail.to_owned(),
    }
}

/// Whether the head version has been run, and how its run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeadRun {
    NotRun,
    Succeeded,
    Failed,
}

/// The one thing the engine does next.
#[derive(Debug)]
pub enum Action<'r> {
    /// Apply the item's recommended `alternative` to step `subject` (a Rule). `at` is the
    /// item's index in the review.
    Apply {
        at: usize,
        item: &'r MethodologyReviewItem,
        subject: &'r str,
        alternative: &'r str,
    },
    /// Compare the routes of the item's rule on step `subject`, on fixed folds (a Try), then
    /// apply the winner.
    Compare {
        item: &'r MethodologyReviewItem,
        subject: &'r str,
    },
    /// Run the head: `reason` is the first rule that measures rows it has not produced.
    Run { reason: String },
    Stop {
        reason: WalkStopReason,
        detail: String,
    },
}

/// What to do with `review` of the head, whose run state is `head`. A recommended
/// limitation stops the walk at once. Otherwise applies come first, then a run, then a
/// comparison; a version is run once. When nothing is left to act on, the walk stops, naming what is still open.
/// A rule that reads a guessed question fact is an Ask, never applied (`unconfirmed_reads`).
pub fn next_action<'r>(
    review: &'r MethodologyReview,
    question: &QuestionVersion,
    head: HeadRun,
    rules: &RuleCatalog,
) -> Result<Action<'r>, ResolveError> {
    for item in &review.items {
        if item.status == MethodologyReviewStatus::Settled && is_limitation(item, rules)? {
            return Ok(Action::Stop {
                reason: WalkStopReason::Limitation,
                detail: describe(item),
            });
        }
    }

    let (mut run, mut compare) = (None, None);
    let (mut asks, mut uncovered, mut unrun) = (Vec::new(), Vec::new(), Vec::new());
    for (at, item) in review
        .next
        .iter()
        .filter_map(|&at| Some((at as usize, review.items.get(at as usize)?)))
    {
        match item.status {
            MethodologyReviewStatus::Proposal => {
                let Some(subject) = &item.subject_node_id else {
                    uncovered.push(describe(item));
                    continue;
                };
                let guesses = unconfirmed_reads(rules.rule(item.rule.as_str())?, question)?;
                if !guesses.is_empty() {
                    asks.push(format!(
                        "{} It reads {}, still a guess: confirm it first.",
                        describe(item),
                        guesses.join(", ")
                    ));
                    continue;
                }
                match &item.recommended_alternative_id {
                    Some(alternative) => {
                        return Ok(Action::Apply {
                            at,
                            item,
                            subject: subject.as_str(),
                            alternative: alternative.as_str(),
                        });
                    }
                    // It depends: the rule leaves the choice to a comparison (a Try).
                    None => {
                        compare.get_or_insert(Action::Compare {
                            item,
                            subject: subject.as_str(),
                        });
                    }
                }
            }
            MethodologyReviewStatus::NeedsRun if head == HeadRun::NotRun => {
                run.get_or_insert_with(|| describe(item));
            }
            MethodologyReviewStatus::NeedsRun => unrun.push(describe(item)),
            MethodologyReviewStatus::NeedsFact => asks.push(describe(item)),
            // A stage the results reopen: no engine action yet.
            _ => uncovered.push(describe(item)),
        }
    }
    if let Some(reason) = run {
        return Ok(Action::Run { reason });
    }
    if let Some(compare) = compare {
        // A person's answer may change what is compared, or how it is scored.
        if !asks.is_empty() {
            let open = asks.join(" ");
            return Ok(Action::Stop {
                reason: WalkStopReason::NeedsPerson,
                detail: format!("Answer these before models are compared: {open}"),
            });
        }
        // The metric must be fixed before any score is seen (ADR-0059).
        if question.success_bar.is_none() {
            return Ok(Action::Stop {
                reason: WalkStopReason::NeedsPerson,
                detail: "State the success bar: its metric is what the routes are compared by, \
                         and it must be fixed before any score is seen."
                    .to_owned(),
            });
        }
        return Ok(compare);
    }
    // A failed run is named even when only Asks are left: its later steps were never judged.
    let (reason, open) = if head == HeadRun::Failed {
        (WalkStopReason::RunFailed, [unrun, uncovered, asks].concat())
    } else if !unrun.is_empty() || !uncovered.is_empty() {
        (WalkStopReason::Uncovered, [unrun, uncovered, asks].concat())
    } else if !asks.is_empty() {
        (WalkStopReason::NeedsPerson, asks)
    } else {
        return Ok(Action::Stop {
            reason: WalkStopReason::Complete,
            detail: "Every rule that fits the question is settled.".to_owned(),
        });
    };
    Ok(Action::Stop {
        reason,
        detail: open.join(" "),
    })
}

/// What the look asks of a person from `review` (ADR-0063 amendment): each fact a rule needs
/// stated, each rule that reads a guess, and the success bar, which fixes the metric before
/// any score is seen (ADR-0059). In review order, the success bar last.
pub fn look_asks(
    review: &MethodologyReview,
    question: &QuestionVersion,
    rules: &RuleCatalog,
) -> Result<Vec<WalkAsk>, ResolveError> {
    let mut asks = Vec::new();
    for item in review
        .next
        .iter()
        .filter_map(|&at| review.items.get(at as usize))
    {
        let text = match item.status {
            MethodologyReviewStatus::NeedsFact => describe(item),
            MethodologyReviewStatus::Proposal => {
                let guesses = unconfirmed_reads(rules.rule(item.rule.as_str())?, question)?;
                if guesses.is_empty() {
                    continue;
                }
                format!(
                    "{} It reads {}, still a guess: confirm it first.",
                    describe(item),
                    guesses.join(", ")
                )
            }
            _ => continue,
        };
        asks.push(parse(
            &json!({ "decides": item.decides, "question": text }).to_string(),
        )?);
    }
    if question.success_bar.is_none() {
        asks.push(parse(
            &json!({
                "decides": "question.success_bar",
                "question": "State the success bar: its metric is what models are compared by, \
                             and it must be fixed before any score is seen.",
            })
            .to_string(),
        )?);
    }
    Ok(asks)
}

/// The question facts `rule` reads that are still a guess (`inferred`). A rule's default is
/// not applied over one (ADR-0059: a guess is confirmed before anything depends on it): the
/// person's answer may change the decision, such as a time column that makes a split temporal.
pub fn unconfirmed_reads(
    rule: &MethodologyRule,
    question: &QuestionVersion,
) -> Result<Vec<String>, ResolveError> {
    let facts = serde_json::to_value(question)?;
    Ok(rule
        .reads
        .iter()
        .filter_map(|read| read.as_str().strip_prefix("question."))
        .filter(|name| facts.get(*name).and_then(|f| f.get("origin")) == Some(&json!("inferred")))
        .map(|name| format!("question.{name}"))
        .collect())
}

/// Whether the item's recommended route reports a limit the engine cannot go past.
fn is_limitation(item: &MethodologyReviewItem, rules: &RuleCatalog) -> Result<bool, CatalogError> {
    let Some(recommended) = &item.recommended_alternative_id else {
        return Ok(false);
    };
    let rule = rules.rule(item.rule.as_str())?;
    Ok(rule.alternatives.iter().any(|a| {
        a.id.as_str() == recommended.as_str()
            && a.action.type_ == RuleActionType::EmitMethodologyLimitation
    }))
}

fn describe(item: &MethodologyReviewItem) -> String {
    match &item.subject_node_id {
        Some(step) => format!(
            "{} (step {}): {}",
            item.decides.as_str(),
            step.as_str(),
            item.reason.as_str()
        ),
        None => format!("{}: {}", item.decides.as_str(), item.reason.as_str()),
    }
}
