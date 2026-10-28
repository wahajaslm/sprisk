//! The engine (ADR-0060): what it builds from a question and its sources, and what the look
//! asks of a person. Pure: the API reads, decides and runs.

use serde_json::{Value, json};
use sprisk_contracts::{
    Edge, Node, Origin, PipelineVersion, QuestionVersion, TaskType, WalkAsk, WalkStopReason, parse,
};

use crate::{Defaults, ResolveError, compare::SEED};

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
    // A stated entity boundary holds from the first flow: the plan gate refuses a random
    // split of repeated entities before any evidence could be measured.
    let split = match &question.entity_column {
        Some(entity) => json!({
            "id": "split",
            "operator": defaults.group_split.as_ref().ok_or(ResolveError::NoGroupSplit)?,
            "params": {
                "group_column": entity.value.as_str(),
                "test_fraction": TEST_FRACTION,
                "seed": SEED,
            },
        }),
        None => json!({
            "id": "split", "operator": defaults.split,
            "params": { "test_fraction": TEST_FRACTION, "seed": SEED },
        }),
    };
    nodes.push(split);
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

/// What the look asks of a person (ADR-0063 amendment), from the question alone: the success
/// bar, which fixes the metric before any score is seen (ADR-0059); a goal that is only a
/// guess; and how far a person must follow a prediction.
pub fn question_asks(question: &QuestionVersion) -> Result<Vec<WalkAsk>, ResolveError> {
    let mut asks = Vec::new();
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
    if question.objective.origin == Origin::Inferred {
        asks.push(parse(
            &json!({
                "decides": "question.objective",
                "question": format!("Confirm the goal: {}", question.objective.value.as_str()),
            })
            .to_string(),
        )?);
    }
    if question.interpretability.is_none() {
        asks.push(parse(
            &json!({
                "decides": "question.interpretability",
                "question": "State how far a person must follow each prediction: high (only \
                             models a person can read), medium or low.",
            })
            .to_string(),
        )?);
    }
    Ok(asks)
}
