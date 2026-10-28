#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};
use sprisk_contracts::{QuestionVersion, WalkStopReason, parse};
use sprisk_methodology::engine::{SHARES_NODE, Start, question_asks, start, with_test_scoring};
use sprisk_methodology::{Defaults, ResolveError};

/// The repo's role defaults, as the API reads them from its registry.
fn defaults() -> Defaults {
    let plugins = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    Defaults::of(&sprisk_registry::Registry::load_dir(&plugins).unwrap()).unwrap()
}

/// The success bar a person states, its metric what models are compared by.
fn barred() -> Value {
    json!({ "success_bar": { "value": { "metric": "weighted_f1", "score": 0.8 }, "origin": "explicit" },
            "interpretability": { "value": "low", "origin": "explicit" } })
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
fn the_first_flow_respects_a_declared_entity_boundary() {
    let Start::Flow { nodes, .. } = start(
        &question(json!({
            "entity_column": { "value": "productid", "origin": "explicit" }
        })),
        &["/data/products.csv".to_owned()],
        &defaults(),
    )
    .unwrap() else {
        panic!("expected a flow");
    };
    assert_eq!(
        nodes[1],
        json!({
            "id": "split",
            "operator": "sprisk.validation.group_split@1.0.0",
            "params": { "group_column": "productid", "test_fraction": 0.2, "seed": 0 }
        })
    );
}

#[test]
fn a_declared_entity_with_no_group_split_registered_is_refused() {
    let refused = start(
        &question(json!({
            "entity_column": { "value": "productid", "origin": "explicit" }
        })),
        &["/data/products.csv".to_owned()],
        &Defaults {
            group_split: None,
            ..defaults()
        },
    );
    assert!(matches!(refused, Err(ResolveError::NoGroupSplit)));
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
    assert_eq!(score.operator.as_str(), "sprisk.ml.evaluate@2.1.0");
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
        "sprisk.ml.evaluate@2.1.0"
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
            { "id": "score_test", "operator": "sprisk.ml.evaluate@2.1.0", "params": {} },
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
                { "id": taken, "operator": "sprisk.ml.evaluate@2.1.0", "params": {} },
            ]),
            json!([{ "from": "split.train", "to": "model.train" }]),
        );
        let err = with_test_scoring(&pipeline, &defaults()).unwrap_err();
        assert!(err.to_string().contains(taken), "{err}");
    }
}

fn asked(asks: &[sprisk_contracts::WalkAsk]) -> Vec<String> {
    asks.iter().map(|a| a.decides.to_string()).collect()
}

#[test]
fn the_look_asks_for_the_success_bar_and_how_far_to_follow_a_prediction_when_unstated() {
    let mut facts = barred();
    let stated = facts.as_object_mut().unwrap();
    stated.remove("success_bar");
    stated.remove("interpretability");
    let asks = question_asks(&question(facts)).unwrap();
    assert_eq!(
        asked(&asks),
        ["question.success_bar", "question.interpretability"]
    );
}

#[test]
fn the_look_asks_nothing_once_everything_is_stated() {
    let asks = question_asks(&question(barred())).unwrap();
    assert!(asks.is_empty(), "{asks:?}");
}

#[test]
fn the_look_asks_how_far_a_person_must_follow_a_prediction_when_the_question_does_not_say() {
    let mut facts = barred();
    facts.as_object_mut().unwrap().remove("interpretability");
    let asks = question_asks(&question(facts)).unwrap();
    assert_eq!(asked(&asks), ["question.interpretability"]);
}

#[test]
fn the_look_asks_to_confirm_a_goal_that_is_only_a_guess() {
    let mut facts = barred();
    facts["objective"] = json!({ "value": "Find the churners.", "origin": "inferred" });
    let asks = question_asks(&question(facts)).unwrap();
    assert_eq!(asked(&asks), ["question.objective"]);
}
