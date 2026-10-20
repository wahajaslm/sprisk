#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{PipelineVersion, QuestionVersion, RuleDecision, parse};
use sprisk_methodology::{RuleCatalog, observation, profile_facts, proposal};

const SPLIT: &str = "methodology.supervised.data_split@1.0.0";

fn catalog() -> RuleCatalog {
    RuleCatalog::load_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology")).unwrap()
}

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

fn decision(alternatives: Value) -> RuleDecision {
    parse(
        &json!({
            "schema_version": "sprisk.rule_decision/v1",
            "rule": SPLIT,
            "recommended_alternative_id": "stratified_random",
            "alternatives": alternatives,
            "evidence": [{ "kind": "question_fact", "label": "Target", "value": "churned", "origin": "confirmed" }]
        })
        .to_string(),
    )
    .unwrap()
}

#[test]
fn an_observation_carries_the_question_facts_and_the_rule_thresholds() {
    let catalog = catalog();
    let rule = catalog.rule(SPLIT).unwrap();
    let observed =
        serde_json::to_value(observation(rule, &question(), Default::default()).unwrap()).unwrap();

    assert_eq!(observed["facts"]["question.target"]["value"], "churned");
    assert_eq!(
        observed["facts"]["question.task"]["value"],
        "classification"
    );
    assert_eq!(
        observed["facts"]["question.time_column"]["origin"],
        "inferred"
    );
    assert!(observed["facts"].get("question.entity_column").is_none());
    assert_eq!(observed["settings"]["default_test_fraction"], 0.2);
}

#[test]
fn a_proposal_takes_labels_and_operators_from_the_manifest_and_params_from_the_decision() {
    let catalog = catalog();
    let rule = catalog.rule(SPLIT).unwrap();
    let decided = decision(json!([
        { "id": "temporal", "applicability": "needs_fact", "reason": "Confirm the time column." },
        { "id": "stratified_random", "applicability": "applicable", "reason": "Keeps class shares.",
          "params": { "stratify": "churned", "test_fraction": 0.2, "seed": 42 } }
    ]));
    let built = proposal(
        rule,
        &decided,
        &question(),
        &pipeline(),
        "split",
        "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
        "2026-10-15T10:00:00Z",
    )
    .unwrap();
    let built = serde_json::to_value(built).unwrap();

    assert_eq!(built["rule"], SPLIT);
    assert_eq!(built["recommended_alternative_id"], "stratified_random");
    let temporal = &built["alternatives"][0];
    assert_eq!(temporal["label"], "Temporal (Chronological) Split");
    assert!(temporal.get("effect").is_none());
    let stratified = &built["alternatives"][1];
    assert_eq!(
        stratified["effect"]["operator"],
        "sprisk.validation.random_split@1.0.0"
    );
    assert_eq!(stratified["effect"]["node_id"], "split");
    assert_eq!(stratified["effect"]["params"]["stratify"], "churned");
}

#[test]
fn a_decision_naming_an_alternative_the_manifest_lacks_is_refused() {
    let catalog = catalog();
    let rule = catalog.rule(SPLIT).unwrap();
    let decided = decision(json!([
        { "id": "stratified_random", "applicability": "applicable", "reason": "r", "params": {} },
        { "id": "made_up", "applicability": "applicable", "reason": "r", "params": {} }
    ]));
    let err = proposal(
        rule,
        &decided,
        &question(),
        &pipeline(),
        "split",
        "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
        "2026-10-15T10:00:00Z",
    )
    .unwrap_err();
    assert!(err.to_string().contains("made_up"), "{err}");
}

#[test]
fn profile_facts_cover_only_the_steps_columns_and_omit_what_was_not_measured() {
    let profile = parse(
        &json!({
            "total_rows": 200, "total_columns": 3, "profiled_rows": 200, "band_rows": 5,
            "columns": [
                { "name": "income", "data_type": "Float64", "missing": 50, "distinct": 140,
                  "missing_by_band": [], "skewness": 2.5, "kurtosis": 9.0, "outlier_share": 0.07 },
                { "name": "city", "data_type": "String", "missing": 0, "distinct": 12, "missing_by_band": [] },
                { "name": "other", "data_type": "Int64", "missing": 0, "distinct": 3, "missing_by_band": [] }
            ],
            "correlation": { "columns": [], "pairs": [] }
        })
        .to_string(),
    )
    .unwrap();
    let facts = profile_facts(&profile, &["income".into(), "city".into()]);

    assert_eq!(facts["rows"], 200);
    assert_eq!(facts["column.income.missing_share"], 0.25);
    assert_eq!(facts["column.income.kurtosis"], 9.0);
    assert_eq!(facts["column.city.data_type"], "String");
    assert!(facts.get("column.city.skewness").is_none());
    assert!(facts.keys().all(|k| !k.starts_with("column.other.")));
}
