#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::TaskType;
use sprisk_contracts::{DecisionProposal, MethodologyRule, PipelineVersion, parse};
use sprisk_methodology::RuleCatalog;
use sprisk_methodology::review::{Outcome, Planned, fits_task, item, next, plan, waits_on};
use sprisk_registry::Registry;

fn catalog() -> RuleCatalog {
    RuleCatalog::load_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology")).unwrap()
}

fn flow(nodes: &[(&str, &str)], edges: &[(&str, &str)]) -> PipelineVersion {
    let nodes: Vec<Value> = nodes
        .iter()
        .map(|(id, op)| json!({ "id": id, "operator": format!("sprisk.{op}@1.0.0"), "params": {} }))
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

/// Load → Split → Fill gaps → Linear model.
fn filled_linear() -> PipelineVersion {
    flow(
        &[
            ("source", "io.file_source"),
            ("split", "validation.random_split"),
            ("fill", "clean.impute"),
            ("model", "ml.linear_model"),
        ],
        &[
            ("source.data", "split.data"),
            ("split.train", "fill.train"),
            ("split.test", "fill.test"),
            ("fill.train", "model.train"),
            ("fill.test", "model.test"),
        ],
    )
}

/// A classification question: clustering rules do not fit it.
fn supervised(rule: &MethodologyRule) -> bool {
    !rule.decides.as_str().starts_with("clustering.")
}

fn planned(pipeline: &PipelineVersion) -> Vec<(String, Option<String>)> {
    let catalog = catalog();
    plan(&catalog, pipeline, supervised)
        .unwrap()
        .iter()
        .map(|p| {
            (
                p.rule.decides.to_string(),
                p.subject.map(|n| n.id.to_string()),
            )
        })
        .collect()
}

#[test]
fn the_plan_puts_the_split_before_the_rules_that_measure_train_rows() {
    let at = |s: &str| Some(s.to_owned());
    assert_eq!(
        planned(&filled_linear()),
        vec![
            ("split.method".to_owned(), at("split")),
            ("cleaning.missingness_strategy".to_owned(), at("fill")),
            ("cleaning.outlier_strategy".to_owned(), None),
            ("features.encoding_strategy".to_owned(), at("model")),
            ("features.scaling_strategy".to_owned(), None),
            ("modeling.estimator_selection".to_owned(), at("model")),
            ("evaluation.decision_threshold".to_owned(), at("model")),
        ]
    );
}

fn split_proposal(alternative: Value) -> DecisionProposal {
    parse(
        &json!({
            "schema_version": "sprisk.decision_proposal/v1",
            "id": "mpr_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "rule": "methodology.supervised.data_split@1.0.0",
            "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "subject_node_id": "split",
            "evidence": [],
            "alternatives": [alternative],
            "recommended_alternative_id": "temporal",
            "fingerprint": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "created_at": "2026-10-19T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap()
}

fn temporal(effect: Value) -> Value {
    json!({ "id": "temporal", "label": "Temporal split", "description": "Train before test.",
            "applicability": "applicable", "reason": "The question declares a time column.",
            "effect": effect })
}

/// The review item for the split rule on `filled_linear`'s split step.
fn split_item(outcome: Outcome) -> Value {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    serde_json::to_value(item(&planned[0], outcome).unwrap()).unwrap()
}

fn proposed(alternative: Value) -> Outcome {
    Outcome::Proposed {
        proposal: Box::new(split_proposal(alternative)),
        decided: false,
    }
}

#[test]
fn a_change_the_rule_recommends_is_a_proposal_with_its_reason() {
    let effect = json!({ "kind": "replace_node", "node_id": "split",
                         "operator": "sprisk.validation.temporal_split@1.0.0", "params": {} });
    let item = split_item(proposed(temporal(effect)));
    assert_eq!(item["status"], "proposal");
    assert_eq!(item["reason"], "The question declares a time column.");
    assert_eq!(item["recommended_alternative_id"], "temporal");
    assert_eq!(item["subject_node_id"], "split");
    assert_eq!(item["decides"], "split.method");
}

#[test]
fn a_recommendation_the_step_already_matches_is_settled() {
    let same = json!({ "kind": "replace_node", "node_id": "split",
                       "operator": "sprisk.validation.random_split@1.0.0", "params": {} });
    assert_eq!(split_item(proposed(temporal(same)))["status"], "settled");
}

#[test]
fn a_recommendation_that_changes_nothing_is_settled() {
    let mut nothing = temporal(Value::Null);
    nothing.as_object_mut().unwrap().remove("effect");
    assert_eq!(split_item(proposed(nothing))["status"], "settled");
}

#[test]
fn a_step_that_carries_this_rules_decision_is_settled_even_when_overridden() {
    let effect = json!({ "kind": "replace_node", "node_id": "split",
                         "operator": "sprisk.validation.temporal_split@1.0.0", "params": {} });
    let outcome = Outcome::Proposed {
        proposal: Box::new(split_proposal(temporal(effect))),
        decided: true,
    };
    assert_eq!(split_item(outcome)["status"], "settled");
}

#[test]
fn a_recommendation_that_needs_a_fact_asks_for_it() {
    let mut asks = temporal(Value::Null);
    asks["applicability"] = json!("needs_fact");
    asks["reason"] = json!("Name the time column.");
    asks.as_object_mut().unwrap().remove("effect");
    let item = split_item(proposed(asks));
    assert_eq!(item["status"], "needs_fact");
    assert_eq!(item["reason"], "Name the time column.");
}

#[test]
fn a_rule_without_train_rows_yet_needs_a_run() {
    let item = split_item(Outcome::NeedsRun("run the flow first".into()));
    assert_eq!(item["status"], "needs_run");
    assert_eq!(item["reason"], "run the flow first");
}

#[test]
fn a_rule_behind_an_open_item_waits_for_it() {
    let item = split_item(Outcome::Waiting {
        on: "cleaning.missingness_strategy".into(),
    });
    assert_eq!(item["status"], "waiting");
    assert_eq!(
        item["reason"],
        "Waits for cleaning.missingness_strategy, which is still open."
    );
}

#[test]
fn a_rule_with_no_step_says_which_steps_it_decides() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let scaling: &Planned = planned.iter().find(|p| p.subject.is_none()).unwrap();
    let item = serde_json::to_value(item(scaling, Outcome::NoSubject).unwrap()).unwrap();
    assert_eq!(item["status"], "no_subject");
    assert!(item.get("subject_node_id").is_none());
    assert!(
        item["reason"]
            .as_str()
            .unwrap()
            .starts_with("No step runs ")
    );
}

fn index_of(planned: &[Planned], decides: &str) -> usize {
    planned
        .iter()
        .position(|p| p.rule.decides.as_str() == decides)
        .unwrap()
}

#[test]
fn a_rule_that_measures_rows_after_an_open_upstream_step_waits_for_it() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let mut open = vec![false; planned.len()];
    open[index_of(&planned, "cleaning.missingness_strategy")] = true;
    let encoding = index_of(&planned, "features.encoding_strategy");
    assert_eq!(
        waits_on(&pipeline, &planned, encoding, &open),
        Some("cleaning.missingness_strategy")
    );
}

#[test]
fn an_open_split_makes_every_rule_that_measures_rows_wait() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let mut open = vec![false; planned.len()];
    open[0] = true;
    let missing = index_of(&planned, "cleaning.missingness_strategy");
    assert_eq!(
        waits_on(&pipeline, &planned, missing, &open),
        Some("split.method")
    );
}

#[test]
fn with_nothing_open_before_it_a_rule_does_not_wait() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let open = vec![false; planned.len()];
    let encoding = index_of(&planned, "features.encoding_strategy");
    assert_eq!(waits_on(&pipeline, &planned, encoding, &open), None);
}

#[test]
fn next_lists_the_open_items_that_wait_for_nothing() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let effect = json!({ "kind": "replace_node", "node_id": "split",
                         "operator": "sprisk.validation.temporal_split@1.0.0", "params": {} });
    let items = vec![
        item(
            &planned[0],
            Outcome::Proposed {
                proposal: Box::new(split_proposal(temporal(effect))),
                decided: false,
            },
        )
        .unwrap(),
        item(
            &planned[1],
            Outcome::Waiting {
                on: "split.method".into(),
            },
        )
        .unwrap(),
        item(&planned[2], Outcome::NoSubject).unwrap(),
        item(&planned[3], Outcome::NeedsRun("run the flow first".into())).unwrap(),
    ];
    assert_eq!(next(&items), vec![0, 3]);
}

#[test]
fn a_rule_fits_a_task_when_one_of_its_steps_is_not_a_model_or_is_a_model_for_that_task() {
    let catalog = catalog();
    let registry =
        Registry::load_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins")).unwrap();
    let fits = |decides: &str, task| {
        let rule = catalog
            .rules()
            .find(|r| r.decides.as_str() == decides)
            .unwrap();
        fits_task(rule, task, registry.operators())
    };
    assert!(fits(
        "cleaning.missingness_strategy",
        TaskType::Classification
    ));
    assert!(fits("modeling.estimator_selection", TaskType::Regression));
    assert!(!fits(
        "clustering.algorithm_choice",
        TaskType::Classification
    ));
}

#[test]
fn a_shortlist_with_no_single_pick_is_a_proposal_to_compare() {
    let mut proposal = serde_json::to_value(split_proposal(without_effect())).unwrap();
    proposal
        .as_object_mut()
        .unwrap()
        .remove("recommended_alternative_id");
    proposal["shortlist"] = json!(["temporal"]);
    let outcome = Outcome::Proposed {
        proposal: Box::new(parse(&proposal.to_string()).unwrap()),
        decided: false,
    };
    let item = split_item(outcome);
    assert_eq!(item["status"], "proposal");
    assert_eq!(item["reason"], "Compare the shortlist: temporal.");
}

#[test]
fn a_recommendation_the_proposal_does_not_offer_is_an_error() {
    let mut proposal = serde_json::to_value(split_proposal(without_effect())).unwrap();
    proposal["recommended_alternative_id"] = json!("group");
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let outcome = Outcome::Proposed {
        proposal: Box::new(parse(&proposal.to_string()).unwrap()),
        decided: false,
    };
    assert!(item(&planned[0], outcome).is_err());
}

fn without_effect() -> Value {
    let mut alternative = temporal(Value::Null);
    alternative.as_object_mut().unwrap().remove("effect");
    alternative
}

#[test]
fn a_rule_with_no_step_never_waits_since_it_has_nothing_to_decide() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let mut open = vec![false; planned.len()];
    open[0] = true;
    let outliers = index_of(&planned, "cleaning.outlier_strategy");
    assert_eq!(waits_on(&pipeline, &planned, outliers, &open), None);
}
