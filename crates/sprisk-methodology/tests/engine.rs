#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};
use sprisk_contracts::{MethodologyReview, QuestionVersion, WalkStopReason, parse};
use sprisk_methodology::engine::{
    Action, HeadRun, SHARES_NODE, Start, look_asks, next_action, start, unconfirmed_reads,
    with_test_scoring,
};
use sprisk_methodology::{Defaults, RuleCatalog};

mod repo;
use repo::rules_with_example_split;

fn catalog() -> RuleCatalog {
    rules_with_example_split()
}

/// The repo's role defaults, as the API reads them from its registry.
fn defaults() -> Defaults {
    let plugins = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    Defaults::of(&sprisk_registry::Registry::load_dir(&plugins).unwrap()).unwrap()
}

const SPLIT: &str = "methodology.supervised.data_split@1.0.0";
const DUPLICATES: &str = "methodology.common.exact_duplicates@1.0.0";
const CONSTRAINTS: &str = "methodology.common.hard_constraints@1.0.0";
const SHORTLIST: &str = "methodology.supervised.model_baseline_selection@2.1.0";
const LOOP_BACK: &str = "methodology.supervised.loop_back@1.0.0";

/// A review item: (rule, decides, status, recommended alternative).
fn item(rule: &str, decides: &str, status: &str, recommended: Option<&str>) -> Value {
    let mut built = json!({
        "rule": rule, "decides": decides, "stage": "data", "subject_node_id": "split",
        "status": status, "reason": format!("{decides} is {status}."),
    });
    if let Some(recommended) = recommended {
        built["recommended_alternative_id"] = json!(recommended);
    }
    built
}

/// A review of `items`, with `next` listing every open item that is not waiting.
fn review(items: Vec<Value>) -> MethodologyReview {
    let next: Vec<usize> = items
        .iter()
        .enumerate()
        .filter(|(_, i)| {
            ["proposal", "needs_fact", "needs_run", "reopen"]
                .contains(&i["status"].as_str().unwrap())
        })
        .map(|(at, _)| at)
        .collect();
    parse(
        &json!({
            "schema_version": "sprisk.methodology_review/v1",
            "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "items": items, "next": next,
        })
        .to_string(),
    )
    .unwrap()
}

fn stop(action: Action) -> (WalkStopReason, String) {
    match action {
        Action::Stop { reason, detail } => (reason, detail),
        other => panic!("expected a stop, got {other:?}"),
    }
}

#[test]
fn a_rule_s_recommended_change_is_applied_before_anything_is_run() {
    let review = review(vec![
        item(DUPLICATES, "data.exact_duplicates", "needs_run", None),
        item(SPLIT, "split.method", "proposal", Some("stratified_split")),
    ]);
    let action = next_action(&review, &question(json!({})), HeadRun::NotRun, &catalog()).unwrap();
    let Action::Apply {
        item, alternative, ..
    } = action
    else {
        panic!("expected an apply, got {action:?}");
    };
    assert_eq!(item.decides.as_str(), "split.method");
    assert_eq!(alternative, "stratified_split");
}

#[test]
fn a_rule_that_measures_rows_the_head_has_not_produced_runs_it() {
    let review = review(vec![item(
        DUPLICATES,
        "data.exact_duplicates",
        "needs_run",
        None,
    )]);
    let action = next_action(&review, &question(json!({})), HeadRun::NotRun, &catalog()).unwrap();
    assert!(matches!(action, Action::Run { .. }), "{action:?}");
}

#[test]
fn a_version_is_run_once_so_rows_still_missing_after_its_run_stop_the_walk() {
    let review = review(vec![item(
        DUPLICATES,
        "data.exact_duplicates",
        "needs_run",
        None,
    )]);
    let (reason, detail) = stop(
        next_action(
            &review,
            &question(json!({})),
            HeadRun::Succeeded,
            &catalog(),
        )
        .unwrap(),
    );
    assert_eq!(reason, WalkStopReason::Uncovered);
    assert!(detail.contains("data.exact_duplicates"), "{detail}");

    let (reason, _) =
        stop(next_action(&review, &question(json!({})), HeadRun::Failed, &catalog()).unwrap());
    assert_eq!(reason, WalkStopReason::RunFailed);
}

#[test]
fn a_failed_run_does_not_stop_the_walk_while_a_rule_can_act_on_it() {
    let review = review(vec![
        item(DUPLICATES, "data.exact_duplicates", "needs_run", None),
        item(SPLIT, "split.method", "proposal", Some("stratified_split")),
    ]);
    let action = next_action(&review, &question(json!({})), HeadRun::Failed, &catalog()).unwrap();
    assert!(matches!(action, Action::Apply { .. }), "{action:?}");
}

#[test]
fn only_facts_a_person_must_state_stop_the_walk_for_them() {
    let review = review(vec![
        item(
            CONSTRAINTS,
            "question.hard_constraints",
            "needs_fact",
            Some("ask"),
        ),
        item(SPLIT, "split.method", "settled", Some("stratified_split")),
    ]);
    let (reason, detail) = stop(
        next_action(
            &review,
            &question(json!({})),
            HeadRun::Succeeded,
            &catalog(),
        )
        .unwrap(),
    );
    assert_eq!(reason, WalkStopReason::NeedsPerson);
    assert!(detail.contains("question.hard_constraints"), "{detail}");
    let (reason, _) =
        stop(next_action(&review, &question(json!({})), HeadRun::Failed, &catalog()).unwrap());
    assert_eq!(
        reason,
        WalkStopReason::RunFailed,
        "a failed run is named before the asks"
    );
    assert!(
        !detail.contains("split.method"),
        "settled items are not open: {detail}"
    );
}

#[test]
fn an_ask_does_not_hold_back_a_rule_that_does_not_wait_for_it() {
    let review = review(vec![
        item(
            CONSTRAINTS,
            "question.hard_constraints",
            "needs_fact",
            Some("ask"),
        ),
        item(SPLIT, "split.method", "proposal", Some("stratified_split")),
    ]);
    let action = next_action(
        &review,
        &question(json!({})),
        HeadRun::Succeeded,
        &catalog(),
    )
    .unwrap();
    assert!(matches!(action, Action::Apply { .. }), "{action:?}");
}

#[test]
fn nothing_open_completes_the_walk() {
    let review = review(vec![item(
        SPLIT,
        "split.method",
        "settled",
        Some("stratified_split"),
    )]);
    let (reason, _) = stop(
        next_action(
            &review,
            &question(json!({})),
            HeadRun::Succeeded,
            &catalog(),
        )
        .unwrap(),
    );
    assert_eq!(reason, WalkStopReason::Complete);
}

#[test]
fn a_recommended_limitation_stops_the_walk_before_any_change() {
    let review = review(vec![
        item(SPLIT, "split.method", "proposal", Some("stratified_split")),
        item(LOOP_BACK, "evaluation.loop_back", "settled", Some("stop")),
    ]);
    let (reason, detail) = stop(
        next_action(
            &review,
            &question(json!({})),
            HeadRun::Succeeded,
            &catalog(),
        )
        .unwrap(),
    );
    assert_eq!(reason, WalkStopReason::Limitation);
    assert!(detail.contains("evaluation.loop_back"), "{detail}");
}

#[test]
fn a_rule_that_leaves_the_choice_open_is_compared_after_changes_and_runs() {
    let shortlist = item(SHORTLIST, "modeling.estimator_selection", "proposal", None);
    let split = item(SPLIT, "split.method", "proposal", Some("stratified_random"));
    let rows = item(DUPLICATES, "data.exact_duplicates", "needs_run", None);
    let asked = question(barred());
    let catalog = catalog();

    let only = review(vec![shortlist.clone()]);
    let action = next_action(&only, &asked, HeadRun::Succeeded, &catalog).unwrap();
    assert!(
        matches!(action, Action::Compare { subject: "split", item } if item.decides.as_str() == "modeling.estimator_selection"),
        "a shortlist is compared: {action:?}"
    );
    let with_change = review(vec![shortlist.clone(), split]);
    let action = next_action(&with_change, &asked, HeadRun::Succeeded, &catalog).unwrap();
    assert!(
        matches!(
            action,
            Action::Apply {
                alternative: "stratified_random",
                ..
            }
        ),
        "a rule's change comes before a comparison: {action:?}"
    );
    let with_rows = review(vec![shortlist, rows]);
    let action = next_action(&with_rows, &asked, HeadRun::NotRun, &catalog).unwrap();
    assert!(
        matches!(action, Action::Run { .. }),
        "the flow is run before a comparison: {action:?}"
    );
}

#[test]
fn a_shortlist_that_reads_a_guessed_task_is_asked_not_compared() {
    let review = review(vec![item(
        SHORTLIST,
        "modeling.estimator_selection",
        "proposal",
        None,
    )]);
    let guessed = question(json!({ "task": { "value": "classification", "origin": "inferred" } }));
    let (reason, detail) =
        stop(next_action(&review, &guessed, HeadRun::Succeeded, &catalog()).unwrap());
    assert_eq!(reason, WalkStopReason::NeedsPerson);
    assert!(detail.contains("question.task, still a guess"), "{detail}");
}

/// The success bar a person states, its metric what models are compared by.
fn barred() -> Value {
    json!({ "success_bar": { "value": { "metric": "weighted_f1", "score": 0.8 }, "origin": "explicit" } })
}

#[test]
fn models_are_compared_only_once_the_success_bar_fixes_the_metric() {
    let review = review(vec![item(
        SHORTLIST,
        "modeling.estimator_selection",
        "proposal",
        None,
    )]);
    let (reason, detail) = stop(
        next_action(
            &review,
            &question(json!({})),
            HeadRun::Succeeded,
            &catalog(),
        )
        .unwrap(),
    );
    assert_eq!(reason, WalkStopReason::NeedsPerson);
    assert!(detail.contains("success bar"), "{detail}");
}

#[test]
fn a_comparison_waits_for_what_a_person_is_asked() {
    let shortlist = item(SHORTLIST, "modeling.estimator_selection", "proposal", None);
    let asked = item(CONSTRAINTS, "question.hard_constraints", "needs_fact", None);
    let review = review(vec![shortlist, asked]);
    let (reason, detail) =
        stop(next_action(&review, &question(barred()), HeadRun::Succeeded, &catalog()).unwrap());
    assert_eq!(reason, WalkStopReason::NeedsPerson);
    assert!(detail.contains("question.hard_constraints"), "{detail}");
}

/// A Rakuten-shaped question: which product type, from the listing's text.
fn question(fields: Value) -> QuestionVersion {
    let mut q = json!({
        "schema_version": "sprisk.question_version/v1",
        "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "objective": { "value": "Tell each listing's product type from its text.", "origin": "explicit" },
        "task": { "value": "classification", "origin": "explicit" },
        "target": { "value": "prdtypecode", "origin": "explicit" },
        "assumptions": [], "unknowns": [], "acceptance_criteria": [],
        "created_at": "2026-10-22T10:00:00Z"
    });
    for (key, value) in fields.as_object().unwrap() {
        if value.is_null() {
            q.as_object_mut().unwrap().remove(key);
        } else {
            q[key] = value.clone();
        }
    }
    parse(&q.to_string()).unwrap()
}

#[test]
fn the_first_flow_is_a_load_per_source_a_split_and_a_baseline_on_the_target() {
    let sources = [
        "/data/x_train.csv".to_owned(),
        "/data/y_train.parquet".to_owned(),
    ];
    let Start::Flow { nodes, edges } = start(&question(json!({})), &sources, &defaults()).unwrap()
    else {
        panic!("expected a flow");
    };
    assert_eq!(
        nodes,
        vec![
            json!({"id":"load","operator":"sprisk.io.file_source@1.0.0",
                   "params":{"path":"/data/x_train.csv","format":"csv"}}),
            json!({"id":"load_2","operator":"sprisk.io.file_source@1.0.0",
                   "params":{"path":"/data/y_train.parquet","format":"parquet"}}),
            json!({"id":"split","operator":"sprisk.validation.random_split@1.0.0",
                   "params":{"test_fraction":0.2,"seed":0}}),
            json!({"id":"model","operator":"sprisk.ml.dummy_baseline@3.0.0",
                   "params":{"target":"prdtypecode","task":"classification"}}),
        ]
    );
    assert_eq!(
        edges,
        vec![
            json!({"from":"load.data","to":"split.data"}),
            json!({"from":"split.train","to":"model.train"}),
        ],
        "the second source has no reader: the join rule joins it"
    );
}

#[test]
fn no_stated_target_stops_before_anything_is_built() {
    for target in [
        Value::Null,
        json!({ "value": "prdtypecode", "origin": "inferred" }),
    ] {
        let started = start(
            &question(json!({ "target": target })),
            &["/d.csv".to_owned()],
            &defaults(),
        );
        let Start::Stop { reason, detail } = started.unwrap() else {
            panic!("expected a stop");
        };
        assert_eq!(reason, WalkStopReason::NeedsPerson);
        assert!(detail.contains("target"), "{detail}");
    }
}

#[test]
fn a_question_with_no_supervised_task_is_not_walked_yet() {
    let undetermined =
        question(json!({ "task": { "value": "undetermined", "origin": "inferred" } }));
    let Start::Stop { reason, .. } =
        start(&undetermined, &["/d.csv".to_owned()], &defaults()).unwrap()
    else {
        panic!("expected a stop");
    };
    assert_eq!(reason, WalkStopReason::NeedsPerson);

    let exploration = question(json!({ "task": { "value": "exploration", "origin": "explicit" } }));
    let Start::Stop { reason, .. } =
        start(&exploration, &["/d.csv".to_owned()], &defaults()).unwrap()
    else {
        panic!("expected a stop");
    };
    assert_eq!(reason, WalkStopReason::Uncovered);
}

#[test]
fn a_source_that_is_not_csv_or_parquet_is_refused() {
    let err = start(
        &question(json!({})),
        &["/data/x.xlsx".to_owned()],
        &defaults(),
    )
    .err()
    .unwrap();
    assert!(err.to_string().contains("/data/x.xlsx"), "{err}");
    let err = start(&question(json!({})), &[], &defaults()).err().unwrap();
    assert!(err.to_string().contains("source"), "{err}");
}

#[test]
fn a_rule_that_reads_a_guessed_fact_is_asked_not_applied() {
    let both = review(vec![
        item(SPLIT, "split.method", "proposal", Some("stratified_random")),
        item(
            DUPLICATES,
            "data.exact_duplicates",
            "proposal",
            Some("drop_duplicates"),
        ),
    ]);
    let guessed = question(json!({ "time_column": { "value": "date", "origin": "inferred" } }));
    let action = next_action(&both, &guessed, HeadRun::Succeeded, &catalog()).unwrap();
    let Action::Apply { at, .. } = action else {
        panic!("the rule that reads no guess is still applied: {action:?}");
    };
    assert_eq!(
        at, 1,
        "the split reads the guessed time column, so it waits"
    );

    let split = review(vec![item(
        SPLIT,
        "split.method",
        "proposal",
        Some("temporal"),
    )]);
    let (reason, detail) =
        stop(next_action(&split, &guessed, HeadRun::Succeeded, &catalog()).unwrap());
    assert_eq!(reason, WalkStopReason::NeedsPerson);
    assert!(
        detail.contains("question.time_column, still a guess"),
        "{detail}"
    );

    let stated = question(json!({ "time_column": { "value": "date", "origin": "explicit" } }));
    let action = next_action(&split, &stated, HeadRun::Succeeded, &catalog()).unwrap();
    assert!(matches!(action, Action::Apply { .. }), "{action:?}");
}

#[test]
fn only_guessed_question_facts_a_rule_reads_are_unconfirmed() {
    let catalog = catalog();
    let split = catalog.rule(SPLIT).unwrap();
    let guessed = question(json!({
        "time_column": { "value": "date", "origin": "inferred" },
        "unit_of_analysis": { "value": "listing", "origin": "inferred" },
    }));
    assert_eq!(
        unconfirmed_reads(split, &guessed).unwrap(),
        ["question.time_column"]
    );
    assert!(
        unconfirmed_reads(split, &question(json!({})))
            .unwrap()
            .is_empty()
    );
}

fn flow(nodes: Value, edges: Value) -> sprisk_contracts::PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": nodes, "edges": edges, "created_at": "2026-10-23T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

fn edges_of(edges: &[sprisk_contracts::Edge]) -> Vec<String> {
    let mut all: Vec<String> = edges
        .iter()
        .map(|e| format!("{} -> {}", e.from.as_str(), e.to.as_str()))
        .collect();
    all.sort();
    all
}

#[test]
fn the_test_rows_are_scored_as_the_model_s_train_rows_were_prepared_with_its_words() {
    let model = json!({ "id": "model", "operator": "sprisk.ml.linear_model@3.0.0",
                        "params": { "target": "y", "task": "classification" } });
    let pipeline = flow(
        json!([
            { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {} },
            { "id": "text", "operator": "sprisk.clean.vectorize_text@1.1.0",
              "params": { "columns": ["title"] } },
            model,
        ]),
        json!([
            { "from": "split.train", "to": "text.train" },
            { "from": "split.test", "to": "text.test" },
            { "from": "text.train", "to": "model.train" },
            { "from": "text.train_words", "to": "model.words" },
        ]),
    );

    let (nodes, edges) = with_test_scoring(&pipeline, &defaults()).unwrap();

    let score = nodes
        .iter()
        .find(|n| n.id.as_str() == "score_test")
        .unwrap();
    assert_eq!(score.operator.as_str(), "sprisk.ml.evaluate@2.0.0");
    assert_eq!(
        serde_json::to_value(&score.params).unwrap(),
        json!({ "target": "y", "task": "classification" })
    );
    let added: Vec<String> = edges_of(&edges)
        .into_iter()
        .filter(|e| e.contains("score_test"))
        .collect();
    assert_eq!(
        added,
        [
            "model.model -> score_test.model",
            "text.test -> score_test.test",
            "text.test_words -> score_test.words",
        ]
    );
}

/// A random split straight into a model of `task`.
fn split_into_model(task: &str) -> sprisk_contracts::PipelineVersion {
    flow(
        json!([
            { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {} },
            { "id": "model", "operator": "sprisk.ml.random_forest@3.0.0",
              "params": { "target": "y", "task": task } },
        ]),
        json!([{ "from": "split.train", "to": "model.train" }]),
    )
}

#[test]
fn a_classifier_s_score_measures_the_class_shares_of_its_train_and_test_rows() {
    let (nodes, edges) =
        with_test_scoring(&split_into_model("classification"), &defaults()).unwrap();

    let shares = nodes.iter().find(|n| n.id.as_str() == SHARES_NODE).unwrap();
    assert_eq!(
        shares.operator.as_str(),
        "sprisk.validation.class_shares@2.0.0"
    );
    assert_eq!(
        serde_json::to_value(&shares.params).unwrap(),
        json!({ "target": "y" })
    );
    let added: Vec<String> = edges_of(&edges)
        .into_iter()
        .filter(|e| e.contains(SHARES_NODE))
        .collect();
    assert_eq!(
        added,
        [
            "split.test -> class_shares.test",
            "split.train -> class_shares.train"
        ]
    );
}

#[test]
fn a_regression_s_score_has_no_class_shares() {
    let (nodes, _) = with_test_scoring(&split_into_model("regression"), &defaults()).unwrap();
    assert!(nodes.iter().all(|n| n.id.as_str() != SHARES_NODE));
}

#[test]
fn the_baseline_is_scored_on_the_same_test_rows_beside_the_model() {
    let model = json!({ "id": "model", "operator": "sprisk.ml.random_forest@3.0.0",
                        "params": { "target": "y", "task": "classification", "exclude": ["id"],
                                    "n_estimators": 50,
                                    "costs": { "positive": "yes", "false_negative": 5.0,
                                               "false_positive": 1.0 } } });
    let pipeline = flow(
        json!([
            { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {} },
            { "id": "text", "operator": "sprisk.clean.vectorize_text@1.1.0",
              "params": { "columns": ["title"] } },
            model,
        ]),
        json!([
            { "from": "split.train", "to": "text.train" },
            { "from": "split.test", "to": "text.test" },
            { "from": "text.train", "to": "model.train" },
            { "from": "text.train_words", "to": "model.words" },
        ]),
    );

    let (nodes, edges) = with_test_scoring(&pipeline, &defaults()).unwrap();

    let node = |id: &str| nodes.iter().find(|n| n.id.as_str() == id).unwrap();
    let baseline = node("test_baseline");
    assert_eq!(baseline.operator.as_str(), "sprisk.ml.dummy_baseline@3.0.0");
    // What the model reads and what its mistakes cost, not how it is fit.
    assert_eq!(
        serde_json::to_value(&baseline.params).unwrap(),
        json!({ "target": "y", "task": "classification", "exclude": ["id"],
                "costs": { "positive": "yes", "false_negative": 5.0, "false_positive": 1.0 } })
    );
    assert_eq!(
        node("score_baseline").operator.as_str(),
        "sprisk.ml.evaluate@2.0.0"
    );
    let added: Vec<String> = edges_of(&edges)
        .into_iter()
        .filter(|e| e.contains("baseline"))
        .collect();
    // The same train rows, test rows and words as the model.
    assert_eq!(
        added,
        [
            "test_baseline.model -> score_baseline.model",
            "text.test -> score_baseline.test",
            "text.test_words -> score_baseline.words",
            "text.train -> test_baseline.train",
            "text.train_words -> test_baseline.words",
        ]
    );
}

#[test]
fn a_flow_already_scored_on_its_test_rows_is_not_scored_again() {
    let pipeline = flow(
        json!([
            { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {} },
            { "id": "model", "operator": "sprisk.ml.dummy_baseline@3.0.0",
              "params": { "target": "y", "task": "classification" } },
            { "id": "score_test", "operator": "sprisk.ml.evaluate@2.0.0", "params": {} },
        ]),
        json!([{ "from": "split.train", "to": "model.train" }]),
    );
    let err = with_test_scoring(&pipeline, &defaults()).unwrap_err();
    assert!(err.to_string().contains("score_test"), "{err}");
}

#[test]
fn a_flow_holding_a_baseline_scoring_step_is_not_scored_again() {
    for taken in ["test_baseline", "score_baseline"] {
        let pipeline = flow(
            json!([
                { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {} },
                { "id": "model", "operator": "sprisk.ml.linear_model@3.0.0",
                  "params": { "target": "y", "task": "classification" } },
                { "id": taken, "operator": "sprisk.ml.evaluate@2.0.0", "params": {} },
            ]),
            json!([{ "from": "split.train", "to": "model.train" }]),
        );
        let err = with_test_scoring(&pipeline, &defaults()).unwrap_err();
        assert!(err.to_string().contains(taken), "{err}");
    }
}

const HTML: &str = "methodology.common.html_text@1.0.0";

fn asked(asks: &[sprisk_contracts::WalkAsk]) -> Vec<String> {
    asks.iter().map(|a| a.decides.to_string()).collect()
}

#[test]
fn the_look_lists_every_fact_a_person_must_state_and_every_guess_a_rule_reads() {
    let review = review(vec![
        item(CONSTRAINTS, "question.hard_constraints", "needs_fact", None),
        item(HTML, "data.html_text", "proposal", Some("strip")),
        item(
            DUPLICATES,
            "data.exact_duplicates",
            "proposal",
            Some("drop_duplicates"),
        ),
    ]);
    let guessed = question(json!({ "time_column": { "value": "date", "origin": "inferred" } }));
    let asks = look_asks(&review, &guessed, &catalog()).unwrap();
    assert_eq!(
        asked(&asks),
        [
            "question.hard_constraints",
            "data.html_text",
            "question.success_bar"
        ]
    );
    assert!(
        asks[1]
            .question
            .contains("question.time_column, still a guess"),
        "{:?}",
        asks[1].question
    );
}

#[test]
fn the_look_asks_nothing_once_everything_is_stated() {
    let review = review(vec![
        item(CONSTRAINTS, "question.hard_constraints", "settled", None),
        item(
            DUPLICATES,
            "data.exact_duplicates",
            "proposal",
            Some("drop_duplicates"),
        ),
    ]);
    let asks = look_asks(&review, &question(barred()), &catalog()).unwrap();
    assert!(asks.is_empty(), "{asks:?}");
}
