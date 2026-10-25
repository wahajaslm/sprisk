#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::TaskType;
use sprisk_contracts::{DecisionProposal, MethodologyRule, PipelineVersion, parse};
use sprisk_methodology::RuleCatalog;
use sprisk_methodology::review::{
    Outcome, Planned, comes_after, decided_for, fits_task, is_open, item, next, plan, waits_on,
};
use sprisk_registry::Registry;

mod repo;
use repo::rules_with_examples;

fn catalog() -> RuleCatalog {
    rules_with_examples()
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
            // It reads no rows, so nothing orders it after the split.
            ("question.hard_constraints".to_owned(), at("model")),
            ("question.objective".to_owned(), at("source")),
            ("question.target_definition".to_owned(), at("source")),
            ("question.unit_of_prediction".to_owned(), at("split")),
            ("split.method".to_owned(), at("split")),
            ("cleaning.missingness_strategy".to_owned(), at("fill")),
            // Question rules on the model measure its train rows, so they follow the fill.
            ("question.error_costs".to_owned(), at("model")),
            ("cleaning.outlier_strategy".to_owned(), None),
            ("features.scaling_strategy".to_owned(), at("model")),
            // The steps shaping a model's inputs, in INPUT_SHAPE order: rare categories (which
            // keep a gap), gaps filled, then encoding, which refuses gaps.
            ("features.rare_categories".to_owned(), at("model")),
            ("cleaning.missingness_strategy".to_owned(), at("model")),
            ("features.encoding_strategy".to_owned(), at("model")),
            ("features.skew_transform".to_owned(), at("model")),
            ("modeling.interpretability_requirement".to_owned(), None),
            ("modeling.estimator_selection".to_owned(), at("model")),
            ("evaluation.decision_threshold".to_owned(), at("model")),
            ("evaluation.loop_back".to_owned(), at("model")),
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
    serde_json::to_value(item(&planned[index_of(&planned, "split.method")], outcome).unwrap())
        .unwrap()
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
    open[index_of(&planned, "split.method")] = true;
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
    assert!(item(&planned[index_of(&planned, "split.method")], outcome).is_err());
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

/// Load → Split (stratified, 25% test, seed 7) → Linear model.
fn stratified_at(params: Value) -> PipelineVersion {
    let mut pipeline = serde_json::to_value(filled_linear()).unwrap();
    pipeline["nodes"][1]["params"] = params;
    parse(&pipeline.to_string()).unwrap()
}

fn stratified_proposal(params: Value) -> Outcome {
    let alternative = json!({ "id": "stratified_random", "label": "Stratified", "description": "d",
        "applicability": "applicable", "reason": "Keeps each class's share.",
        "effect": { "kind": "replace_node", "node_id": "split",
                    "operator": "sprisk.validation.random_split@1.0.0", "params": params } });
    let mut proposal = serde_json::to_value(split_proposal(alternative)).unwrap();
    proposal["recommended_alternative_id"] = json!("stratified_random");
    Outcome::Proposed {
        proposal: Box::new(parse(&proposal.to_string()).unwrap()),
        decided: false,
    }
}

#[test]
fn a_step_that_differs_only_in_the_route_s_settings_is_settled() {
    let catalog = catalog();
    let pipeline =
        stratified_at(json!({ "stratify": "churned", "test_fraction": 0.25, "seed": 7 }));
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let outcome =
        stratified_proposal(json!({ "stratify": "churned", "test_fraction": 0.2, "seed": 42 }));
    let item =
        serde_json::to_value(item(&planned[index_of(&planned, "split.method")], outcome).unwrap())
            .unwrap();
    assert_eq!(item["status"], "settled", "{item}");
}

#[test]
fn a_step_that_differs_in_what_the_route_decides_is_a_proposal() {
    let catalog = catalog();
    let pipeline = stratified_at(json!({ "test_fraction": 0.2, "seed": 42 }));
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let outcome =
        stratified_proposal(json!({ "stratify": "churned", "test_fraction": 0.2, "seed": 42 }));
    let item =
        serde_json::to_value(item(&planned[index_of(&planned, "split.method")], outcome).unwrap())
            .unwrap();
    assert_eq!(item["status"], "proposal", "{item}");
}

#[test]
fn a_decision_on_a_step_feeding_the_subject_counts_as_the_rule_s_decision() {
    // A rule anchored on the model adds a step before it; that step carries the decision.
    let pipeline = filled_linear();
    let by_rule = |n: &sprisk_contracts::Node| n.id.as_str() == "fill";
    assert!(sprisk_methodology::review::carries_decision(
        &pipeline, "model", by_rule
    ));
    assert!(!sprisk_methodology::review::carries_decision(
        &pipeline, "split", by_rule
    ));
}

#[test]
fn a_setting_outside_the_route_s_allowed_range_is_not_settled() {
    let catalog = catalog();
    let pipeline =
        stratified_at(json!({ "stratify": "churned", "test_fraction": 0.95, "seed": 7 }));
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let outcome =
        stratified_proposal(json!({ "stratify": "churned", "test_fraction": 0.2, "seed": 42 }));
    let item =
        serde_json::to_value(item(&planned[index_of(&planned, "split.method")], outcome).unwrap())
            .unwrap();
    assert_eq!(item["status"], "proposal", "{item}");
}

#[test]
fn a_step_is_after_the_split_when_a_split_feeds_it() {
    let pipeline = filled_linear();
    let is_split = |n: &sprisk_contracts::Node| n.id.as_str() == "split";
    assert!(sprisk_methodology::review::after_a_split(
        &pipeline, "model", is_split
    ));
    assert!(!sprisk_methodology::review::after_a_split(
        &pipeline, "source", is_split
    ));
    assert!(!sprisk_methodology::review::after_a_split(
        &pipeline, "split", is_split
    ));
}

/// `rule` rewritten to read cross-validation results, with `temporal`, when it has one,
/// reopening the features.
fn reading_results(rule: &MethodologyRule) -> MethodologyRule {
    let mut value = serde_json::to_value(rule).unwrap();
    value["reads"] = json!(["cv.score"]);
    for alternative in value["alternatives"].as_array_mut().unwrap() {
        if alternative["id"] == "temporal" {
            alternative["action"] = json!({ "type": "reopen", "params": { "stage": "features" } });
        }
    }
    parse(&value.to_string()).unwrap()
}

#[test]
fn a_recommendation_to_reopen_is_open_and_names_the_stage() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let split = &planned[index_of(&planned, "split.method")];
    let rule = reading_results(split.rule);
    let reopening = Planned {
        rule: &rule,
        subject: split.subject,
    };
    let mut reopen = temporal(Value::Null);
    reopen.as_object_mut().unwrap().remove("effect");
    reopen["reason"] = json!("The score misses the bar.");

    let item = item(&reopening, proposed(reopen)).unwrap();
    let shown = serde_json::to_value(&item).unwrap();
    assert_eq!(shown["status"], "reopen");
    assert_eq!(shown["reopens"], "features");
    assert_eq!(shown["reason"], "The score misses the bar.");
    assert!(is_open(&item));
    assert_eq!(next(&[item]), vec![0]);
}

#[test]
fn a_rule_reading_results_comes_after_the_rules_of_its_own_step_that_do_not() {
    let catalog = catalog();
    let pipeline = filled_linear();
    let planned = plan(&catalog, &pipeline, supervised).unwrap();
    let shortlist = &planned[index_of(&planned, "modeling.estimator_selection")];
    let threshold = &planned[index_of(&planned, "evaluation.decision_threshold")];
    let results = reading_results(threshold.rule);
    let reading = Planned {
        rule: &results,
        subject: threshold.subject,
    };
    let other = reading_results(shortlist.rule);
    let also_reading = Planned {
        rule: &other,
        subject: shortlist.subject,
    };

    assert!(comes_after(&pipeline, &reading, shortlist));
    assert!(!comes_after(&pipeline, &reading, &also_reading));
    assert!(!comes_after(&pipeline, threshold, shortlist));
}

#[test]
fn a_step_upstream_settles_a_subject_only_with_a_decision_made_for_that_subject() {
    let decision = |subject: &str| -> sprisk_contracts::MethodologyDecisionByRule {
        let mut d: Value = serde_json::from_str(include_str!(
            "../../../tests/contract/methodology_decision/valid/applied.json"
        ))
        .unwrap();
        d["subject_node_id"] = json!(subject);
        parse(&d.to_string()).unwrap()
    };
    // The Impute a rule added for the model settles it; a person's own Impute, decided for
    // itself, leaves the model's other gaps open.
    assert!(decided_for("model", "gaps", &decision("model")));
    assert!(!decided_for("model", "fill", &decision("fill")));
    // A step's own decision settles it, whatever subject it was made for.
    assert!(decided_for("gaps", "gaps", &decision("model")));
}
