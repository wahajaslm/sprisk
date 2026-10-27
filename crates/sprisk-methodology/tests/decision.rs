#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{
    DecisionProposal, Node, Operator, PipelineVersion, QuestionVersion, SelectionMetric, TaskType,
    parse,
};
use sprisk_methodology::ResolveError;
use sprisk_methodology::deciding::{Basis, bindings, compared_proposal};
use sprisk_methodology::{
    Candidates, Comparison, Scoring, Stamp, comparison, key_columns, train_rows_source,
    unread_sources, with_node_before, without_node,
};
use sprisk_registry::Registry;

mod repo;
use repo::{copy_dir, repo_catalog};

fn question() -> QuestionVersion {
    parse(
        &json!({
            "schema_version": "sprisk.question_version/v1",
            "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "objective": { "value": "Predict churn", "origin": "explicit" },
            "task": { "value": "classification", "origin": "confirmed" },
            "target": { "value": "churned", "origin": "confirmed" },
            "time_column": { "value": "signup_date", "origin": "inferred" },
            "assumptions": [], "unknowns": [], "acceptance_criteria": [],
            "created_at": "2026-10-15T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap()
}

fn pipeline() -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [{ "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {} }],
            "edges": [],
            "created_at": "2026-10-15T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap()
}

fn flow(nodes: &[(&str, &str)], edges: &[(&str, &str)]) -> PipelineVersion {
    let nodes: Vec<Value> = nodes
        .iter()
        .map(|(id, op)| {
            let operator = if op.contains('@') {
                format!("sprisk.{op}")
            } else {
                format!("sprisk.{op}@1.0.0")
            };
            json!({ "id": id, "operator": operator, "params": {} })
        })
        .collect();
    let edges: Vec<Value> = edges
        .iter()
        .map(|(from, to)| json!({ "from": from, "to": to }))
        .collect();
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": nodes, "edges": edges,
            "created_at": "2026-10-15T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap()
}

/// The operators the repo's plugins declare, as the API looks them up.
fn registry() -> Registry {
    Registry::load_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins")).unwrap()
}

fn before_forest() -> PipelineVersion {
    flow(
        &[
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest@3.0.0"),
            ("eval", "ml.evaluate@2.1.0"),
        ],
        &[
            ("split.train", "scale.train"),
            ("split.test", "scale.test"),
            ("scale.train", "rf.train"),
            ("rf.model", "eval.model"),
            ("scale.test", "eval.test"),
        ],
    )
}

#[test]
fn removing_a_step_feeds_each_output_from_its_input_of_the_same_name() {
    let (nodes, edges) = without_node(&before_forest(), "scale").unwrap();
    assert!(nodes.iter().all(|n| n.id.as_str() != "scale"));
    let mut edges: Vec<String> = edges
        .iter()
        .map(|e| format!("{} -> {}", e.from.as_str(), e.to.as_str()))
        .collect();
    edges.sort();
    assert_eq!(
        edges,
        [
            "rf.model -> eval.model",
            "split.test -> eval.test",
            "split.train -> rf.train"
        ]
    );
}

#[test]
fn a_step_whose_output_has_no_input_of_the_same_name_cannot_be_removed() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("rf", "ml.random_forest@3.0.0"),
            ("eval", "ml.evaluate@2.1.0"),
        ],
        &[("split.train", "rf.train"), ("rf.model", "eval.model")],
    );
    let err = without_node(&pipeline, "rf").unwrap_err();
    assert!(err.to_string().contains("rf.model"), "{err}");
}

#[test]
fn removing_an_unknown_step_is_refused() {
    assert!(without_node(&before_forest(), "nope").is_err());
}

fn encode_step(id: &str) -> Node {
    parse(&json!({ "id": id, "operator": "sprisk.clean.encode@1.0.0", "params": { "columns": ["c"] } }).to_string())
        .unwrap()
}

fn inserted(
    pipeline: &PipelineVersion,
    step: Node,
    before: &str,
) -> Result<(Vec<String>, Vec<String>), ResolveError> {
    joined(pipeline, step, before, None)
}

fn joined(
    pipeline: &PipelineVersion,
    step: Node,
    before: &str,
    other: Option<&str>,
) -> Result<(Vec<String>, Vec<String>), ResolveError> {
    let registry = registry();
    let (nodes, edges) = with_node_before(pipeline, step, before, other, |o| registry.get(o))?;
    let mut edges: Vec<String> = edges
        .iter()
        .map(|e| format!("{} -> {}", e.from.as_str(), e.to.as_str()))
        .collect();
    edges.sort();
    Ok((
        nodes.iter().map(|n| n.id.as_str().to_owned()).collect(),
        edges,
    ))
}

#[test]
fn a_step_added_before_a_model_reads_the_split_and_feeds_the_model_and_its_evaluation() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("chart", "profile.chart"),
            ("rf", "ml.random_forest@3.0.0"),
            ("eval", "ml.evaluate@2.1.0"),
        ],
        &[
            ("split.train", "chart.data"),
            ("split.train", "rf.train"),
            ("rf.model", "eval.model"),
            ("split.test", "eval.test"),
        ],
    );
    let (nodes, edges) = inserted(&pipeline, encode_step("categories"), "rf").unwrap();
    assert_eq!(nodes, ["split", "chart", "categories", "rf", "eval"]);
    // The chart still shows the rows as they were.
    assert_eq!(
        edges,
        [
            "categories.test -> eval.test",
            "categories.train -> rf.train",
            "rf.model -> eval.model",
            "split.test -> categories.test",
            "split.train -> categories.train",
            "split.train -> chart.data",
        ]
    );
}

#[test]
fn a_step_that_makes_words_feeds_them_to_the_model_and_its_evaluation() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("rf", "ml.random_forest@3.0.0"),
            ("eval", "ml.evaluate@2.1.0"),
        ],
        &[
            ("split.train", "rf.train"),
            ("rf.model", "eval.model"),
            ("split.test", "eval.test"),
        ],
    );
    let step = parse(
        &json!({ "id": "text", "operator": "sprisk.clean.vectorize_text@1.1.0",
                 "params": { "columns": ["title"] } })
        .to_string(),
    )
    .unwrap();
    let (nodes, edges) = inserted(&pipeline, step, "rf").unwrap();
    assert_eq!(nodes, ["split", "text", "rf", "eval"]);
    assert_eq!(
        edges,
        [
            "rf.model -> eval.model",
            "split.test -> text.test",
            "split.train -> text.train",
            "text.test -> eval.test",
            "text.test_words -> eval.words",
            "text.train -> rf.train",
            "text.train_words -> rf.words",
        ]
    );
}

#[test]
fn a_step_that_makes_words_is_refused_before_a_step_that_reads_none_or_has_some() {
    let words = |id: &str| -> Node {
        parse(
            &json!({ "id": id, "operator": "sprisk.clean.vectorize_text@1.1.0",
                     "params": { "columns": ["title"] } })
            .to_string(),
        )
        .unwrap()
    };
    let err = inserted(&before_forest(), words("text"), "scale").unwrap_err();
    assert!(err.to_string().contains("scale takes no words"), "{err}");

    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("old", "clean.vectorize_text@1.1.0"),
            ("rf", "ml.random_forest@3.0.0"),
        ],
        &[
            ("split.train", "old.train"),
            ("split.test", "old.test"),
            ("old.train", "rf.train"),
            ("old.train_words", "rf.words"),
        ],
    );
    let err = inserted(&pipeline, words("text"), "rf").unwrap_err();
    assert!(err.to_string().contains("rf already reads words"), "{err}");

    // An evaluation of the model already scoring with other words would score the new model
    // with another step's vocabulary.
    let scored = flow(
        &[
            ("split", "validation.random_split"),
            ("old", "clean.vectorize_text@1.1.0"),
            ("rf", "ml.random_forest@3.0.0"),
            ("eval", "ml.evaluate@2.1.0"),
        ],
        &[
            ("split.train", "old.train"),
            ("split.test", "old.test"),
            ("split.train", "rf.train"),
            ("rf.model", "eval.model"),
            ("split.test", "eval.test"),
            ("old.test_words", "eval.words"),
        ],
    );
    let err = inserted(&scored, words("text"), "rf").unwrap_err();
    assert!(
        err.to_string().contains("eval already reads words"),
        "{err}"
    );
}

#[test]
fn a_step_added_before_a_clean_step_takes_both_its_train_and_test_rows() {
    let (_, edges) = inserted(&before_forest(), encode_step("categories"), "scale").unwrap();
    assert_eq!(
        edges,
        [
            "categories.test -> scale.test",
            "categories.train -> scale.train",
            "rf.model -> eval.model",
            "scale.test -> eval.test",
            "scale.train -> rf.train",
            "split.test -> categories.test",
            "split.train -> categories.train",
        ]
    );
}

#[test]
fn only_a_step_that_learns_from_train_rows_can_be_added() {
    let summary: Node = parse(
        &json!({ "id": "summary", "operator": "sprisk.profile.summarize@1.0.0", "params": {} })
            .to_string(),
    )
    .unwrap();
    let err = inserted(&before_forest(), summary, "rf").unwrap_err();
    assert!(
        err.to_string().contains("sprisk.profile.summarize@1.0.0"),
        "{err}"
    );
}

#[test]
fn a_step_is_added_only_where_train_and_test_rows_feed_it() {
    // The model reads loaded rows, not a split's train rows.
    let pipeline = flow(
        &[("load", "io.file_source"), ("rf", "ml.random_forest@3.0.0")],
        &[("load.data", "rf.train")],
    );
    let err = inserted(&pipeline, encode_step("categories"), "rf").unwrap_err();
    assert!(err.to_string().contains("rf"), "{err}");
    assert!(inserted(&before_forest(), encode_step("categories"), "nope").is_err());
}

fn markers_step(id: &str) -> Node {
    parse(
        &json!({ "id": id, "operator": "sprisk.clean.mark_missing@1.0.0",
                   "params": { "columns": ["age"], "values": ["?"] } })
        .to_string(),
    )
    .unwrap()
}

#[test]
fn a_table_step_added_before_a_split_takes_the_one_table_it_reads() {
    let pipeline = flow(
        &[
            ("load", "io.file_source"),
            ("chart", "profile.chart"),
            ("split", "validation.random_split"),
        ],
        &[("load.data", "chart.data"), ("load.data", "split.data")],
    );
    let (nodes, edges) = inserted(&pipeline, markers_step("markers"), "split").unwrap();
    assert_eq!(nodes, ["load", "chart", "markers", "split"]);
    // The chart still shows the rows as they were loaded.
    assert_eq!(
        edges,
        [
            "load.data -> chart.data",
            "load.data -> markers.data",
            "markers.data -> split.data",
        ]
    );
}

#[test]
fn a_table_step_is_not_added_before_a_step_reading_several_inputs() {
    let err = inserted(&before_forest(), markers_step("markers"), "eval").unwrap_err();
    assert!(
        err.to_string().contains("does not read exactly one table"),
        "{err}"
    );
}

#[test]
fn a_table_step_is_not_added_where_it_would_change_train_rows_only() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("rf", "ml.random_forest@3.0.0"),
        ],
        &[("split.train", "rf.train")],
    );
    let err = inserted(&pipeline, markers_step("markers"), "rf").unwrap_err();
    assert!(err.to_string().contains("test rows would skip it"), "{err}");
}

#[test]
fn an_added_step_needs_an_id_no_step_has() {
    let err = inserted(&before_forest(), encode_step("scale"), "rf").unwrap_err();
    assert!(err.to_string().contains("scale"), "{err}");
}

fn is_split(node: &Node) -> bool {
    node.operator.as_str().starts_with("sprisk.validation.")
}

fn keeps_train(node: &Node) -> bool {
    let operator = node.operator.as_str();
    operator.starts_with("sprisk.clean.scale@")
        || operator.starts_with("sprisk.clean.vectorize_text@")
}

#[test]
fn a_steps_train_rows_come_back_through_preparation_to_the_split() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
            ("model", "ml.linear_model@3.0.0"),
        ],
        &[
            ("split.train", "scale.train"),
            ("scale.train", "model.train"),
        ],
    );
    assert_eq!(
        train_rows_source(&pipeline, "model", is_split, keeps_train).unwrap(),
        "scale"
    );
}

#[test]
fn a_step_that_may_mix_rows_on_the_way_is_refused() {
    // A code step can join its train and test inputs into its train output.
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("code", "code.python@2.0.0"),
            ("model", "ml.linear_model@3.0.0"),
        ],
        &[
            ("split.train", "code.train"),
            ("split.test", "code.test"),
            ("code.train", "model.train"),
        ],
    );
    let err = train_rows_source(&pipeline, "model", is_split, keeps_train).unwrap_err();
    assert!(err.to_string().contains("code"), "{err}");
}

#[test]
fn a_hop_through_a_test_port_is_refused() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
            ("model", "ml.linear_model@3.0.0"),
        ],
        &[("split.test", "scale.train"), ("scale.test", "model.train")],
    );
    assert!(train_rows_source(&pipeline, "model", is_split, keeps_train).is_err());
}

/// load -> split -> scale -> model -> evaluate, with the test rows going to evaluate.
fn evaluated_flow() -> PipelineVersion {
    let mut pipeline = serde_json::to_value(flow(
        &[
            ("load", "io.file_source"),
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
            ("model", "ml.linear_model@3.0.0"),
            ("eval", "ml.evaluate@2.1.0"),
        ],
        &[
            ("load.data", "split.data"),
            ("split.train", "scale.train"),
            ("split.test", "scale.test"),
            ("scale.train", "model.train"),
            ("model.model", "eval.model"),
            ("scale.test", "eval.test"),
        ],
    ))
    .unwrap();
    pipeline["nodes"][3]["params"] =
        json!({ "target": "churned", "features": ["age", "plan"], "task": "classification" });
    parse(&pipeline.to_string()).unwrap()
}

/// A person's proposal for step `model`: the model shortlist method's options, with
/// `shortlist` let through (ADR-0063 D3), as the API offers it.
fn shortlisted(pipeline: &PipelineVersion, shortlist: Value) -> DecisionProposal {
    let catalog = repo_catalog();
    let method = catalog
        .methods()
        .find(|m| m.decides.as_str() == "models.estimator_selection")
        .unwrap();
    let operators: Vec<Operator> = registry().operators().cloned().collect();
    let question = question();
    let effective = bindings(&question, &[]).unwrap();
    let basis = Basis {
        bindings: &effective.bindings,
        pipeline,
        operators: &operators,
        measured: &BTreeMap::new(),
        question: &question,
    };
    let listed = parse(
        &json!({ "answer": "shortlisted", "method": method.id, "shortlist": shortlist,
                 "reason": "Too few rows to trust." })
        .to_string(),
    )
    .unwrap();
    let stamp = Stamp {
        id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
        created_at: "2026-10-15T10:00:00Z",
    };
    compared_proposal(method, &basis, "model", &listed, json!([]), stamp).unwrap()
}

fn compare(
    pipeline: &PipelineVersion,
    proposal: &DecisionProposal,
) -> Result<Comparison, ResolveError> {
    compare_by(pipeline, proposal, None)
}

fn compare_by(
    pipeline: &PipelineVersion,
    proposal: &DecisionProposal,
    stated: Option<SelectionMetric>,
) -> Result<Comparison, ResolveError> {
    let registry = registry();
    comparison(
        pipeline,
        &Candidates::of_proposal(proposal)?,
        Scoring {
            task: TaskType::Classification,
            stated,
            look: 3,
        },
        keeps_train,
        &registry,
    )
}

/// The metric every step of `built` scores by.
fn metrics_of(built: &Comparison) -> BTreeSet<String> {
    built
        .nodes
        .iter()
        .filter_map(|n| n.params.get("metric").and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

#[test]
fn the_metric_a_person_stated_with_the_success_bar_is_what_models_are_compared_by() {
    let pipeline = evaluated_flow();
    let proposal = shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"]));
    let task_default = compare(&pipeline, &proposal).unwrap();
    assert_eq!(
        metrics_of(&task_default),
        BTreeSet::from(["balanced_accuracy".to_owned()])
    );
    let stated = compare_by(&pipeline, &proposal, Some(SelectionMetric::WeightedF1)).unwrap();
    assert_eq!(
        metrics_of(&stated),
        BTreeSet::from(["weighted_f1".to_owned()])
    );
    let err = compare_by(&pipeline, &proposal, Some(SelectionMetric::Rmse)).unwrap_err();
    assert!(err.to_string().contains("rmse"), "{err}");
}

#[test]
fn a_comparison_cross_validates_each_candidate_on_the_splits_train_rows() {
    let pipeline = evaluated_flow();
    let built = compare(
        &pipeline,
        &shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"])),
    )
    .unwrap();

    let ids: Vec<&str> = built.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "load",
            "split",
            "cv_ml_dummy_baseline",
            "cv_ml_linear_model",
            "select_model"
        ]
    );
    let edges: Vec<(&str, &str)> = built
        .edges
        .iter()
        .map(|e| (e.from.as_str(), e.to.as_str()))
        .collect();
    assert_eq!(
        edges,
        [
            ("load.data", "split.data"),
            ("split.train", "cv_ml_dummy_baseline.train"),
            ("split.train", "cv_ml_linear_model.train"),
            (
                "cv_ml_dummy_baseline.scores",
                "select_model.ml_dummy_baseline"
            ),
            ("cv_ml_linear_model.scores", "select_model.ml_linear_model"),
        ]
    );
    let linear = serde_json::to_value(&built.nodes[3]).unwrap();
    assert_eq!(
        linear,
        json!({
            "id": "cv_ml_linear_model", "operator": "sprisk.ml.cross_validate@4.0.0",
            "params": {
                "candidate": "sprisk.ml.linear_model@3.0.0",
                "candidate_params": { "target": "churned", "features": ["age", "plan"], "task": "classification" },
                "folds": 5, "repeats": 10, "seed": 0, "metric": "balanced_accuracy",
                "prepare": [{ "operator": "sprisk.clean.scale@1.0.0", "params": {} }]
            }
        })
    );
    let select = serde_json::to_value(&built.nodes[4]).unwrap();
    assert_eq!(
        select["params"],
        json!({
            "trials": ["ml_dummy_baseline", "ml_linear_model"], "baseline": "ml_dummy_baseline",
            "baseline_role": "floor", "metric": "balanced_accuracy",
            "complexity": { "ml_dummy_baseline": 0, "ml_linear_model": 1 },
            "not_compared": [{ "id": "ml_random_forest", "reason": "Not on the shortlist: Left off: Too few rows to trust." }],
            "looks": 3
        })
    );
}

#[test]
fn a_comparison_never_reads_a_splits_test_or_holdout_rows() {
    let pipeline = evaluated_flow();
    let built = compare(
        &pipeline,
        &shortlisted(
            &pipeline,
            json!(["ml_dummy_baseline", "ml_linear_model", "ml_random_forest"]),
        ),
    )
    .unwrap();

    for edge in &built.edges {
        let (step, port) = edge.from.step_and_port();
        assert!(
            step != "split" || port == "train",
            "{} reads the split's {port} rows",
            edge.to.as_str()
        );
    }
    let fed_by_split = built
        .edges
        .iter()
        .filter(|e| e.from.as_str() == "split.train")
        .count();
    assert_eq!(fed_by_split, 3);
}

#[test]
fn a_comparison_needs_a_baseline_on_the_shortlist() {
    let pipeline = evaluated_flow();
    let mut proposal = serde_json::to_value(shortlisted(
        &pipeline,
        json!(["ml_dummy_baseline", "ml_linear_model"]),
    ))
    .unwrap();
    proposal["shortlist"] = json!(["ml_linear_model", "ml_random_forest"]);
    let proposal: DecisionProposal = parse(&proposal.to_string()).unwrap();

    let err = compare(&pipeline, &proposal).unwrap_err();
    assert!(matches!(err, ResolveError::Selection(_)), "{err}");
    assert!(
        err.to_string().contains("needs exactly one baseline"),
        "{err}"
    );
}

#[test]
fn only_a_shortlist_can_be_compared() {
    let pipeline = evaluated_flow();
    let mut proposal =
        serde_json::to_value(shortlisted(&pipeline, json!(["ml_dummy_baseline"]))).unwrap();
    proposal.as_object_mut().unwrap().remove("shortlist");
    proposal["recommended_alternative_id"] = json!("ml_dummy_baseline");
    let proposal: DecisionProposal = parse(&proposal.to_string()).unwrap();

    let err = compare(&pipeline, &proposal).unwrap_err();
    assert!(
        err.to_string().contains("has no shortlist to compare"),
        "{err}"
    );
}

#[test]
fn a_model_whose_train_rows_do_not_trace_to_a_split_cannot_be_compared() {
    let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
    pipeline["edges"][3] = json!({ "from": "scale.test", "to": "model.train" });
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let proposal = shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"]));

    let err = compare(&pipeline, &proposal).unwrap_err();
    assert!(matches!(err, ResolveError::NotTrainRows(_)), "{err}");
}

#[test]
fn a_comparison_after_a_temporal_or_group_split_folds_the_same_way() {
    // Shuffled folds would validate on earlier rows, or on groups also fit on (ADR-0050).
    for (split, params, fold_by, repeats) in [
        (
            "temporal_split",
            json!({ "time_column": "signup", "test_fraction": 0.2 }),
            json!({ "time_column": "signup" }),
            1,
        ),
        (
            "group_split",
            json!({ "group_column": "customer", "test_fraction": 0.2, "seed": 1 }),
            json!({ "group_column": "customer" }),
            10,
        ),
    ] {
        let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
        pipeline["nodes"][1]["operator"] = json!(format!("sprisk.validation.{split}@1.0.0"));
        pipeline["nodes"][1]["params"] = params;
        let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
        let proposal = shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"]));

        let built = compare(&pipeline, &proposal).unwrap();
        let cv = serde_json::to_value(&built.nodes[2]).unwrap();
        for (key, value) in fold_by.as_object().unwrap() {
            assert_eq!(&cv["params"][key], value, "{split}");
        }
        assert_eq!(cv["params"]["repeats"], repeats, "{split}");
    }
}

#[test]
fn a_split_s_folds_come_from_its_manifest_not_its_name() {
    // A split added as a folder only: another id, folds declared by time (ADR-0064).
    let plugins = tempfile::tempdir().unwrap();
    copy_dir(&repo::repo("plugins"), plugins.path());
    let manifest = std::fs::read_to_string(
        plugins
            .path()
            .join("validation/operators/temporal_split/manifest.yaml"),
    )
    .unwrap()
    .replace(
        "sprisk.validation.temporal_split@1.0.0",
        "acme.validation.later_split@1.0.0",
    );
    let folder = plugins.path().join("validation/operators/later_split");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("manifest.yaml"), manifest).unwrap();
    let registry = Registry::load_dir(plugins.path()).unwrap();
    let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
    pipeline["nodes"][1]["operator"] = json!("acme.validation.later_split@1.0.0");
    pipeline["nodes"][1]["params"] = json!({ "time_column": "signup", "test_fraction": 0.2 });
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let proposal = shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"]));

    let built = comparison(
        &pipeline,
        &Candidates::of_proposal(&proposal).unwrap(),
        Scoring {
            task: TaskType::Classification,
            stated: None,
            look: 1,
        },
        keeps_train,
        &registry,
    )
    .unwrap();

    let cv = serde_json::to_value(&built.nodes[2]).unwrap();
    assert_eq!(cv["params"]["time_column"], "signup");
    assert_eq!(cv["params"]["repeats"], 1);
}

#[test]
fn a_split_that_declares_no_folds_cannot_be_compared() {
    let plugins = tempfile::tempdir().unwrap();
    copy_dir(&repo::repo("plugins"), plugins.path());
    let manifest = std::fs::read_to_string(
        plugins
            .path()
            .join("validation/operators/random_split/manifest.yaml"),
    )
    .unwrap()
    .replace(
        "sprisk.validation.random_split@1.0.0",
        "acme.validation.any_split@1.0.0",
    )
    .replace("role_default: true\n", "")
    .replace("folds: plain\n", "");
    let folder = plugins.path().join("validation/operators/any_split");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("manifest.yaml"), manifest).unwrap();
    let registry = Registry::load_dir(plugins.path()).unwrap();
    let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
    pipeline["nodes"][1]["operator"] = json!("acme.validation.any_split@1.0.0");
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let proposal = shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"]));
    let scoring = Scoring {
        task: TaskType::Classification,
        stated: None,
        look: 1,
    };

    let candidates = Candidates::of_proposal(&proposal).unwrap();
    let err = comparison(&pipeline, &candidates, scoring, keeps_train, &registry).unwrap_err();

    assert!(
        err.to_string()
            .contains("declares no folds, so models cannot be compared on its train rows"),
        "{err}"
    );
}

#[test]
fn a_comparison_refuses_folds_it_cannot_make_faithfully() {
    for (operator, params, why) in [
        (
            // Time folds would put one entity on both sides; the split keeps them apart.
            "sprisk.validation.temporal_split@1.0.0",
            json!({ "time_column": "signup", "group_column": "customer", "test_fraction": 0.2 }),
            "keeps entities apart over time, which time-ordered folds would mix",
        ),
        (
            "sprisk.validation.group_split@1.0.0",
            json!({ "test_fraction": 0.2 }),
            "split step split names no group_column",
        ),
    ] {
        let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
        pipeline["nodes"][1]["operator"] = json!(operator);
        pipeline["nodes"][1]["params"] = params;
        let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
        let proposal = shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"]));

        let err = compare(&pipeline, &proposal).unwrap_err();
        assert!(matches!(err, ResolveError::Selection(_)), "{err}");
        assert!(err.to_string().contains(why), "{operator}: {err}");
    }
}

/// `flow` with step `id` running its own code (ADR-0028).
fn with_own_code(flow: PipelineVersion, id: &str) -> PipelineVersion {
    let mut pipeline = serde_json::to_value(flow).unwrap();
    let node = pipeline["nodes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|n| n["id"] == id)
        .unwrap();
    node["code"] = json!({ "source": "def scale(train, test, columns, method):\n    return train, test\n", "function": "scale" });
    parse(&pipeline.to_string()).unwrap()
}

fn join_step() -> Node {
    parse(&json!({ "id": "join", "operator": "sprisk.io.join@1.0.0", "params": { "key": "unnamed_0" } }).to_string())
        .unwrap()
}

/// Items → split, with the items' codes loaded and read by no step.
fn two_sources() -> PipelineVersion {
    flow(
        &[
            ("items", "io.file_source"),
            ("codes", "io.file_source"),
            ("split", "validation.random_split"),
        ],
        &[("items.data", "split.data")],
    )
}

#[test]
fn a_join_added_before_a_split_reads_its_table_and_the_unread_source() {
    let (nodes, edges) = joined(&two_sources(), join_step(), "split", Some("codes.data")).unwrap();
    assert_eq!(nodes, ["items", "codes", "join", "split"]);
    assert_eq!(
        edges,
        [
            "codes.data -> join.other",
            "items.data -> join.data",
            "join.data -> split.data",
        ]
    );
}

#[test]
fn a_join_needs_its_other_table_and_only_a_join_takes_one() {
    let err = joined(&two_sources(), join_step(), "split", None).unwrap_err();
    assert!(err.to_string().contains("other"), "{err}");
    let err = joined(
        &two_sources(),
        markers_step("markers"),
        "split",
        Some("codes.data"),
    )
    .unwrap_err();
    assert!(err.to_string().contains("other"), "{err}");
}

#[test]
fn the_unread_sources_are_the_loaded_tables_no_step_reads() {
    let registry = registry();
    let found = unread_sources(&two_sources(), |o| registry.get(o)).unwrap();
    let found: Vec<&str> = found.iter().map(|p| p.as_str()).collect();
    assert_eq!(found, ["codes.data"]);
    let mut read = serde_json::to_value(two_sources()).unwrap();
    read["edges"] = json!([{ "from": "items.data", "to": "split.data" }, { "from": "codes.data", "to": "split.data" }]);
    let read: PipelineVersion = parse(&read.to_string()).unwrap();
    assert!(
        unread_sources(&read, |o| registry.get(o))
            .unwrap()
            .is_empty()
    );
}

/// The same cases the Supervised pack's Gate B check runs, so both agree on the key columns.
#[test]
fn key_columns_are_the_questions_unit_and_time_and_every_steps_group_and_time() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/key_columns.json")).unwrap();
    for case in cases {
        let mut asked = serde_json::to_value(question()).unwrap();
        let fields = asked.as_object_mut().unwrap();
        fields.remove("time_column");
        for (name, value) in case["question"].as_object().unwrap() {
            fields.insert(
                name.clone(),
                json!({ "value": value, "origin": "confirmed" }),
            );
        }
        let asked: QuestionVersion = parse(&asked.to_string()).unwrap();
        let mut flow = serde_json::to_value(pipeline()).unwrap();
        flow["nodes"] = case["params"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, params)| json!({ "id": format!("s{i}"), "operator": "sprisk.validation.random_split@1.0.0", "params": params }))
            .collect();
        let flow: PipelineVersion = parse(&flow.to_string()).unwrap();
        let keys: Vec<String> = key_columns(&asked, &flow).into_iter().collect();
        assert_eq!(json!(keys), case["keys"], "{}", case["case"]);
    }
}

/// load → split → Vectorize text → model, the model's words fed from `words`, if any.
fn worded_flow(words: Option<&str>) -> PipelineVersion {
    let mut edges = vec![
        ("load.data", "split.data"),
        ("split.train", "text.train"),
        ("split.test", "text.test"),
        ("text.train", "model.train"),
        ("model.model", "eval.model"),
        ("text.test", "eval.test"),
    ];
    if let Some(from) = words {
        edges.push((from, "model.words"));
    }
    let mut pipeline = serde_json::to_value(flow(
        &[
            ("load", "io.file_source"),
            ("split", "validation.random_split"),
            ("text", "clean.vectorize_text@1.1.0"),
            ("model", "ml.linear_model@3.0.0"),
            ("eval", "ml.evaluate@2.1.0"),
        ],
        &edges,
    ))
    .unwrap();
    pipeline["nodes"][2]["params"] = json!({ "columns": ["title"] });
    pipeline["nodes"][3]["params"] = json!({ "target": "churned", "task": "classification" });
    parse(&pipeline.to_string()).unwrap()
}

#[test]
fn a_comparison_refits_the_words_the_model_reads_and_only_those() {
    let shortlist = json!(["ml_dummy_baseline", "ml_linear_model"]);
    let read = worded_flow(Some("text.train_words"));
    let built = compare(&read, &shortlisted(&read, shortlist.clone())).unwrap();
    let prepares: Vec<&Value> = built
        .nodes
        .iter()
        .filter_map(|n| n.params.get("prepare"))
        .collect();
    assert!(!prepares.is_empty());
    for prepare in prepares {
        assert_eq!(prepare[0]["operator"], "sprisk.clean.vectorize_text@1.1.0");
    }

    // Folds would join words the flow's model never reads, or score test words as train.
    for words in [None, Some("text.test_words")] {
        let flow = worded_flow(words);
        let err = compare(&flow, &shortlisted(&flow, shortlist.clone())).unwrap_err();
        assert!(
            err.to_string().contains("train_words of text"),
            "{words:?}: {err}"
        );
    }
}

#[test]
fn a_comparison_refuses_a_step_it_would_refit_with_other_code_than_the_flows() {
    // A fold refits each step with its operator's code; an edited step would run other code.
    let pipeline = with_own_code(evaluated_flow(), "scale");
    let models = shortlisted(&pipeline, json!(["ml_dummy_baseline", "ml_linear_model"]));
    let err = compare(&pipeline, &models).unwrap_err();
    assert!(matches!(err, ResolveError::OwnCode { .. }), "{err}");
    assert!(
        err.to_string().starts_with("step scale runs its own code"),
        "{err}"
    );
}
