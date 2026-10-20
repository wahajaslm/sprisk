#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{Node, PipelineVersion, QuestionVersion, RuleDecision, parse};
use sprisk_methodology::{RuleCatalog, flow_facts, observation, profile_facts, proposal};
use sprisk_registry::Registry;

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
    let observed = serde_json::to_value(
        observation(rule, &question(), Default::default(), Default::default()).unwrap(),
    )
    .unwrap();

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

/// Steps a test treats as preparation that keeps what the flow facts claim.
fn keeps(node: &Node) -> bool {
    let operator = node.operator.as_str();
    operator.starts_with("sprisk.clean.") || operator.starts_with("sprisk.validation.")
}

fn facts_of(pipeline: &PipelineVersion, node_id: &str) -> serde_json::Map<String, Value> {
    let registry = registry();
    flow_facts(pipeline, node_id, |operator| registry.get(operator), keeps).unwrap()
}

#[test]
fn a_scale_step_upstream_of_a_random_forest_reads_trees_that_prepare_themselves() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest"),
            ("base", "ml.dummy_baseline"),
            ("eval", "ml.evaluate"),
        ],
        &[
            ("scale.train", "rf.train"),
            ("scale.train", "base.train"),
            ("rf.model", "eval.model"),
        ],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_family"]["value"], "tree_ensemble");
    assert_eq!(facts["flow.model_family"]["origin"], "measured");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "all");
    assert_eq!(facts["flow.models_standardize"]["value"], "all");
}

#[test]
fn models_of_several_families_read_mixed() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest"),
            ("lin", "ml.linear_model"),
        ],
        &[("scale.train", "rf.train"), ("scale.train", "lin.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_family"]["value"], "mixed");
    assert_eq!(facts["flow.models_standardize"]["value"], "all");
}

#[test]
fn a_clustering_step_beside_a_forest_means_only_some_models_prepare_themselves() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest"),
            ("km", "clustering.kmeans"),
        ],
        &[("scale.train", "rf.train"), ("scale.train", "km.data")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "some");
    assert_eq!(facts["flow.models_standardize"]["value"], "some");
}

#[test]
fn a_model_reached_through_other_steps_counts_but_one_upstream_does_not() {
    let pipeline = flow(
        &[
            ("lin", "ml.linear_model"),
            ("impute", "clean.impute"),
            ("scale", "clean.scale"),
            ("km", "clustering.kmeans"),
        ],
        &[
            ("lin.model", "impute.data"),
            ("impute.train", "scale.train"),
            ("scale.train", "km.data"),
        ],
    );
    let facts = facts_of(&pipeline, "impute");
    assert_eq!(facts["flow.model_family"]["value"], "distance_based");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "none");
}

#[test]
fn a_dummy_baseline_has_no_family_but_prepares_itself() {
    let pipeline = flow(
        &[("scale", "clean.scale"), ("base", "ml.dummy_baseline")],
        &[("scale.train", "base.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert!(facts.get("flow.model_family").is_none());
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "all");
}

#[test]
fn no_model_downstream_sends_no_flow_facts() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
        ],
        &[("split.train", "scale.train")],
    );
    assert!(facts_of(&pipeline, "scale").is_empty());
}

#[test]
fn a_model_behind_a_step_that_is_not_preparation_makes_the_models_unknown() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("code", "code.python@1.1.0"),
            ("lin", "ml.linear_model"),
        ],
        &[("scale.train", "code.data"), ("code.data", "lin.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_family"]["value"], "unknown");
    assert_eq!(facts["flow.models_standardize"]["value"], "none");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "none");
}

#[test]
fn a_hidden_model_beside_a_seen_one_means_only_some_prepare_themselves() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest"),
            ("code", "code.python@1.1.0"),
            ("lin", "ml.linear_model"),
        ],
        &[
            ("scale.train", "rf.train"),
            ("scale.train", "code.data"),
            ("code.data", "lin.train"),
        ],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_family"]["value"], "unknown");
    assert_eq!(facts["flow.models_standardize"]["value"], "some");
}

#[test]
fn a_step_with_no_model_after_it_hides_nothing() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("summary", "profile.summarize"),
            ("rf", "ml.random_forest"),
        ],
        &[("scale.train", "summary.data"), ("scale.train", "rf.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_family"]["value"], "tree_ensemble");
    assert_eq!(facts["flow.models_standardize"]["value"], "all");
}

#[test]
fn an_operator_missing_from_the_registry_is_refused() {
    let pipeline = flow(
        &[("scale", "clean.scale"), ("mystery", "ml.mystery")],
        &[("scale.train", "mystery.train")],
    );
    let registry = registry();
    let err = flow_facts(&pipeline, "scale", |o| registry.get(o), keeps).unwrap_err();
    assert!(err.to_string().contains("sprisk.ml.mystery@1.0.0"), "{err}");
}

#[test]
fn an_unknown_step_is_refused() {
    let pipeline = flow(&[("scale", "clean.scale")], &[]);
    let registry = registry();
    let err = flow_facts(&pipeline, "nope", |o| registry.get(o), keeps).unwrap_err();
    assert!(err.to_string().contains("nope"), "{err}");
}

#[test]
fn a_model_step_does_not_count_itself() {
    let pipeline = flow(&[("km", "clustering.kmeans")], &[]);
    assert!(facts_of(&pipeline, "km").is_empty());
}

#[test]
fn an_observation_carries_flow_facts_beside_the_question_facts() {
    let catalog = catalog();
    let rule = catalog.rule(SPLIT).unwrap();
    let pipeline = flow(
        &[("scale", "clean.scale"), ("rf", "ml.random_forest")],
        &[("scale.train", "rf.train")],
    );
    let observed = observation(
        rule,
        &question(),
        facts_of(&pipeline, "scale"),
        Default::default(),
    )
    .unwrap();
    let observed = serde_json::to_value(observed).unwrap();
    assert_eq!(
        observed["facts"]["flow.model_family"]["value"],
        "tree_ensemble"
    );
    assert_eq!(observed["facts"]["question.target"]["value"], "churned");
}
