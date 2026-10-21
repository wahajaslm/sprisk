#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{
    DecisionProposal, Node, PipelineVersion, QuestionVersion, RuleDecision, TaskType, parse,
};
use sprisk_methodology::ResolveError;
use sprisk_methodology::{
    Comparison, RuleCatalog, Stamp, candidate_facts, candidates, comparison, flow_facts,
    observation, profile_facts, proposal, train_rows_source, without_node,
};
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
        &Default::default(),
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-15T10:00:00Z",
        },
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
        &Default::default(),
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-15T10:00:00Z",
        },
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
                  "missing_by_band": [], "skewness": 2.5, "kurtosis": 9.0, "outlier_share": 0.07,
                  "iqr": 12.5 },
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
    assert_eq!(facts["column.income.iqr"], 12.5);
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
fn a_scale_step_upstream_of_a_random_forest_reads_trees_that_fill_their_own_gaps() {
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
    assert_eq!(facts["flow.model_families"]["value"], "tree_ensemble");
    assert_eq!(facts["flow.model_families"]["origin"], "measured");
    assert_eq!(facts["flow.models_hidden"]["value"], "none");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "all");
    assert_eq!(facts["flow.models_standardize"]["value"], "some");
}

#[test]
fn models_of_several_families_are_all_listed() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest"),
            ("lin", "ml.linear_model"),
        ],
        &[("scale.train", "rf.train"), ("scale.train", "lin.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(
        facts["flow.model_families"]["value"],
        "linear, tree_ensemble"
    );
    assert_eq!(facts["flow.models_standardize"]["value"], "some");
}

#[test]
fn a_clustering_step_beside_a_forest_means_only_some_models_fill_their_own_gaps() {
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
    assert_eq!(facts["flow.models_standardize"]["value"], "none");
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
    assert_eq!(facts["flow.model_families"]["value"], "distance_based");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "none");
}

#[test]
fn models_that_ignore_their_features_read_featureless() {
    let pipeline = flow(
        &[("scale", "clean.scale"), ("base", "ml.dummy_baseline")],
        &[("scale.train", "base.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_families"]["value"], "featureless");
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
fn a_model_behind_a_step_that_is_not_preparation_is_hidden() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("code", "code.python@1.1.0"),
            ("lin", "ml.linear_model"),
        ],
        &[("scale.train", "code.data"), ("code.data", "lin.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert!(facts.get("flow.model_families").is_none());
    assert_eq!(facts["flow.models_hidden"]["value"], "all");
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
    assert_eq!(facts["flow.model_families"]["value"], "tree_ensemble");
    assert_eq!(facts["flow.models_hidden"]["value"], "some");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "some");
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
    assert_eq!(facts["flow.model_families"]["value"], "tree_ensemble");
    assert_eq!(facts["flow.models_standardize"]["value"], "none");
    assert_eq!(facts["flow.other_readers"]["value"], "summary");
}

#[test]
fn a_code_step_reading_the_output_is_an_other_reader_even_with_no_model() {
    let pipeline = flow(
        &[("scale", "clean.scale"), ("knn", "code.python@1.1.0")],
        &[("scale.train", "knn.data")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.other_readers"]["value"], "knn");
    assert!(facts.get("flow.models_hidden").is_none());
}

#[test]
fn evaluators_and_preparation_steps_are_not_other_readers() {
    let facts = facts_of(&before_forest(), "scale");
    assert!(facts.get("flow.other_readers").is_none(), "{facts:?}");
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
fn a_model_after_a_clustering_step_is_hidden_since_clustering_passes_its_columns_on() {
    let pipeline = flow(
        &[
            ("clip", "clean.clip_outliers"),
            ("db", "clustering.dbscan"),
            ("lin", "ml.linear_model"),
        ],
        &[("clip.train", "db.data"), ("db.data", "lin.train")],
    );
    let facts = facts_of(&pipeline, "clip");
    assert_eq!(facts["flow.model_families"]["value"], "density_based");
    assert_eq!(facts["flow.models_hidden"]["value"], "some");
    assert_eq!(facts["flow.models_fill_gaps"]["value"], "none");
}

#[test]
fn a_model_reached_both_directly_and_through_a_code_step_counts_once_as_hidden() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("code", "code.python@1.1.0"),
            ("lin", "ml.linear_model"),
        ],
        &[
            ("scale.train", "lin.train"),
            ("scale.train", "code.data"),
            ("code.data", "lin.train"),
        ],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.models_hidden"]["value"], "all");
    assert_eq!(facts["flow.models_standardize"]["value"], "none");
}

#[test]
fn a_model_step_does_not_count_itself() {
    let pipeline = flow(&[("km", "clustering.kmeans")], &[]);
    assert!(facts_of(&pipeline, "km").is_empty());
}

#[test]
fn an_observation_carries_flow_facts_beside_the_question_facts() {
    let catalog = catalog();
    let rule = catalog
        .rule("methodology.supervised.outlier_treatment@2.0.0")
        .unwrap();
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
        observed["facts"]["flow.model_families"]["value"],
        "tree_ensemble"
    );
    assert_eq!(observed["facts"]["question.target"]["value"], "churned");
}

const SCALING: &str = "methodology.supervised.feature_scaling@2.0.0";

fn scaling_decision(applicability: &str) -> RuleDecision {
    parse(
        &json!({
            "schema_version": "sprisk.rule_decision/v1",
            "rule": SCALING,
            "recommended_alternative_id": "no_scaling",
            "alternatives": [{ "id": "no_scaling", "applicability": applicability, "reason": "r" }],
            "evidence": []
        })
        .to_string(),
    )
    .unwrap()
}

fn before_forest() -> PipelineVersion {
    flow(
        &[
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest"),
            ("eval", "ml.evaluate"),
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
fn an_applicable_alternative_that_removes_its_step_gets_a_remove_node_effect() {
    let catalog = catalog();
    let rule = catalog.rule(SCALING).unwrap();
    let built = |applicability| {
        let built = proposal(
            rule,
            &scaling_decision(applicability),
            &question(),
            &before_forest(),
            "scale",
            &Default::default(),
            Stamp {
                id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
                created_at: "2026-10-15T10:00:00Z",
            },
        )
        .unwrap();
        serde_json::to_value(built).unwrap()["alternatives"][0].clone()
    };
    assert_eq!(
        built("applicable")["effect"],
        json!({ "kind": "remove_node", "node_id": "scale" })
    );
    assert!(built("not_applicable").get("effect").is_none());
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
            ("rf", "ml.random_forest"),
            ("eval", "ml.evaluate"),
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

#[test]
fn the_steps_own_text_settings_are_facts_so_a_rule_knows_what_it_does_now() {
    let mut pipeline = serde_json::to_value(before_forest()).unwrap();
    pipeline["nodes"][1]["params"] = json!({ "columns": ["age"], "method": "zero" });
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["step.method"]["value"], "zero");
    assert_eq!(facts["step.method"]["origin"], "explicit");
    assert!(facts.get("step.columns").is_none());
}

#[test]
fn an_analysis_step_behind_a_model_still_reads_the_columns() {
    let pipeline = flow(
        &[
            ("clip", "clean.clip_outliers"),
            ("db", "clustering.dbscan"),
            ("summary", "profile.summarize"),
        ],
        &[("clip.train", "db.data"), ("db.clusters", "summary.data")],
    );
    assert_eq!(
        facts_of(&pipeline, "clip")["flow.other_readers"]["value"],
        "summary"
    );
}

#[test]
fn an_observation_holds_only_what_the_rule_reads() {
    let catalog = catalog();
    let split = catalog.rule(SPLIT).unwrap();
    let scale = catalog.rule(SCALING).unwrap();
    let flow = facts_of(&before_forest(), "scale");
    let profile: serde_json::Map<String, Value> = serde_json::from_value(json!({
        "rows": 100, "column.a.b.kurtosis": 2.0, "column.a.b.distinct": 7
    }))
    .unwrap();

    let observed = serde_json::to_value(
        observation(split, &question(), flow.clone(), profile.clone()).unwrap(),
    )
    .unwrap();
    assert!(observed["facts"].get("flow.model_families").is_none());
    assert_eq!(observed["facts"]["question.target"]["value"], "churned");
    assert_eq!(observed["profile"], json!({}));

    let observed =
        serde_json::to_value(observation(scale, &question(), flow, profile).unwrap()).unwrap();
    assert!(observed["facts"].get("question.target").is_none());
    assert_eq!(
        observed["facts"]["flow.models_standardize"]["value"],
        "none"
    );
    // A column name may hold dots; the pattern still matches it.
    assert_eq!(observed["profile"], json!({ "column.a.b.kurtosis": 2.0 }));
}

#[test]
fn every_flow_fact_in_the_catalog_is_one_rust_sends() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest"),
            ("summary", "profile.summarize"),
        ],
        &[("scale.train", "rf.train"), ("scale.train", "summary.data")],
    );
    let sent: Vec<String> = facts_of(&pipeline, "scale")
        .keys()
        .filter(|k| k.starts_with("flow."))
        .cloned()
        .collect();
    let mut catalog: Vec<&str> = sprisk_methodology::facts::FACTS
        .iter()
        .copied()
        .filter(|f| f.starts_with("flow."))
        .collect();
    let mut sent = sent;
    sent.sort();
    catalog.sort();
    assert_eq!(sent, catalog);
}

/// The same cases run in the Python rule harness, so both match `reads` alike.
#[test]
fn a_reads_pattern_covers_the_fact_names_the_shared_cases_say() {
    let cases: Vec<Value> = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fact_patterns.json"),
        )
        .unwrap(),
    )
    .unwrap();
    for case in cases {
        let (pattern, name) = (
            case["pattern"].as_str().unwrap(),
            case["name"].as_str().unwrap(),
        );
        assert_eq!(
            sprisk_methodology::facts::covers(pattern, name),
            case["covers"].as_bool().unwrap(),
            "{case}"
        );
    }
}

fn shortlist_rule() -> sprisk_contracts::MethodologyRule {
    parse(
        &json!({
            "schema_version": "sprisk.methodology_rule/v1",
            "id": "methodology.supervised.model_baseline_selection@2.0.0",
            "name": "Model shortlist", "stage": "models", "decides": "modeling.estimator_selection",
            "status": "active", "selection": "shortlist",
            "applies_to": ["sprisk.ml.linear_model"], "reads": ["candidate.*.family"],
            "provenance": { "standard": "s", "citation": "c", "pitfall": "p", "corner_cases": [] },
            "policy_thresholds": {}, "alternatives": [],
            "verification": { "check_id": "sprisk.checks.x@1.0.0", "invariant": "i" },
            "examples": [{ "given": {}, "shortlist": ["ml_dummy_baseline"] }]
        })
        .to_string(),
    )
    .unwrap()
}

fn shortlist_decision(shortlist: Value, recommended: Option<&str>) -> RuleDecision {
    let mut decided = json!({
        "schema_version": "sprisk.rule_decision/v1",
        "rule": "methodology.supervised.model_baseline_selection@2.0.0",
        "alternatives": [
            { "id": "ml_dummy_baseline", "applicability": "applicable", "reason": "The floor." },
            { "id": "ml_linear_model", "applicability": "applicable", "reason": "Few rows." },
            { "id": "ml_random_forest", "applicability": "applicable", "reason": "Too few rows to trust." }
        ],
        "shortlist": shortlist,
        "evidence": []
    });
    if let Some(r) = recommended {
        decided["recommended_alternative_id"] = json!(r);
    }
    parse(&decided.to_string()).unwrap()
}

/// A flow whose model step is a linear model with these params.
fn model_flow() -> PipelineVersion {
    let mut pipeline = serde_json::to_value(flow(
        &[
            ("split", "validation.random_split"),
            ("model", "ml.linear_model"),
        ],
        &[("split.train", "model.train")],
    ))
    .unwrap();
    pipeline["nodes"][1]["params"] =
        json!({ "target": "churned", "features": ["age", "plan"], "task": "classification" });
    parse(&pipeline.to_string()).unwrap()
}

#[test]
fn the_candidates_are_the_registered_models_that_fit_the_task() {
    let registry = registry();
    let found = candidates(TaskType::Classification, registry.operators()).unwrap();
    assert_eq!(
        found.keys().collect::<Vec<_>>(),
        ["ml_dummy_baseline", "ml_linear_model", "ml_random_forest"]
    );
    let facts = candidate_facts(&found);
    assert_eq!(
        facts["candidate.ml_random_forest.family"]["value"],
        "tree_ensemble"
    );
    assert_eq!(
        facts["candidate.ml_dummy_baseline.family"]["value"],
        "featureless"
    );
    assert!(
        candidates(TaskType::Exploration, registry.operators())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_shortlist_proposal_replaces_the_model_step_with_each_candidate() {
    let registry = registry();
    let candidates = candidates(TaskType::Classification, registry.operators()).unwrap();
    let built = proposal(
        &shortlist_rule(),
        &shortlist_decision(json!(["ml_dummy_baseline", "ml_linear_model"]), None),
        &question(),
        &model_flow(),
        "model",
        &candidates,
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-15T10:00:00Z",
        },
    )
    .unwrap();
    let built = serde_json::to_value(built).unwrap();
    assert_eq!(
        built["shortlist"],
        json!(["ml_dummy_baseline", "ml_linear_model"])
    );
    assert!(built.get("recommended_alternative_id").is_none());
    let forest = &built["alternatives"][2];
    assert_eq!(forest["label"], "sprisk.ml.random_forest@1.0.0");
    assert_eq!(
        forest["effect"]["operator"],
        "sprisk.ml.random_forest@1.0.0"
    );
    assert_eq!(
        forest["effect"]["params"],
        json!({ "target": "churned", "features": ["age", "plan"], "task": "classification" })
    );
}

#[test]
fn a_shortlist_decision_must_shortlist_and_not_recommend() {
    let registry = registry();
    let candidates = candidates(TaskType::Classification, registry.operators()).unwrap();
    let build = |decided: RuleDecision| {
        proposal(
            &shortlist_rule(),
            &decided,
            &question(),
            &model_flow(),
            "model",
            &candidates,
            Stamp {
                id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
                created_at: "2026-10-15T10:00:00Z",
            },
        )
    };
    let selection = |decided| match build(decided) {
        Err(ResolveError::Selection(problem)) => problem,
        other => panic!("expected a selection error, got {other:?}"),
    };
    assert!(selection(shortlist_decision(json!([]), None)).contains("at least one"));
    assert!(
        selection(shortlist_decision(
            json!(["ml_linear_model"]),
            Some("ml_linear_model")
        ))
        .contains("no single")
    );
    assert!(selection(shortlist_decision(json!(["ml_made_up"]), None)).contains("ml_made_up"));
    assert!(selection(shortlist_decision(json!(["ml_linear_model"]), None)).contains("baseline"));
}

#[test]
fn a_recommend_decision_must_pick_one_it_offers_and_give_no_shortlist() {
    let catalog = catalog();
    let rule = catalog.rule(SPLIT).unwrap();
    let build = |recommended: Option<&str>, shortlist: Value| {
        let mut decided = json!({
            "schema_version": "sprisk.rule_decision/v1", "rule": SPLIT,
            "alternatives": [{ "id": "stratified_random", "applicability": "applicable", "reason": "r",
                               "params": { "stratify": "churned", "test_fraction": 0.2, "seed": 42 } }],
            "shortlist": shortlist, "evidence": []
        });
        if let Some(r) = recommended {
            decided["recommended_alternative_id"] = json!(r);
        }
        let decided: RuleDecision = parse(&decided.to_string()).unwrap();
        let stamp = Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-15T10:00:00Z",
        };
        match proposal(
            rule,
            &decided,
            &question(),
            &pipeline(),
            "split",
            &Default::default(),
            stamp,
        ) {
            Err(ResolveError::Selection(problem)) => problem,
            other => panic!("expected a selection error, got {other:?}"),
        }
    };
    assert!(build(None, json!([])).contains("must pick"));
    assert!(
        build(Some("stratified_random"), json!(["stratified_random"])).contains("no shortlist")
    );
    assert!(build(Some("temporal"), json!([])).contains("temporal"));
}

#[test]
fn two_models_with_one_candidate_id_are_refused() {
    let registry = registry();
    let linear = registry.get("sprisk.ml.linear_model@1.0.0").unwrap();
    let mut newer = linear.clone();
    newer.id = parse("\"sprisk.ml.linear_model@2.0.0\"").unwrap();
    let err = candidates(TaskType::Classification, [linear, &newer].into_iter()).unwrap_err();
    assert!(err.to_string().contains("ml_linear_model"), "{err}");
}

fn is_split(node: &Node) -> bool {
    node.operator.as_str().starts_with("sprisk.validation.")
}

fn keeps_train(node: &Node) -> bool {
    node.operator.as_str().starts_with("sprisk.clean.scale@")
}

#[test]
fn a_steps_train_rows_come_back_through_preparation_to_the_split() {
    let pipeline = flow(
        &[
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
            ("model", "ml.linear_model"),
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
            ("model", "ml.linear_model"),
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
            ("model", "ml.linear_model"),
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
            ("model", "ml.linear_model"),
            ("eval", "ml.evaluate"),
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

fn shortlisted(pipeline: &PipelineVersion, shortlist: Value) -> DecisionProposal {
    let registry = registry();
    let candidates = candidates(TaskType::Classification, registry.operators()).unwrap();
    proposal(
        &shortlist_rule(),
        &shortlist_decision(shortlist, None),
        &question(),
        pipeline,
        "model",
        &candidates,
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-15T10:00:00Z",
        },
    )
    .unwrap()
}

fn compare(
    pipeline: &PipelineVersion,
    proposal: &DecisionProposal,
) -> Result<Comparison, ResolveError> {
    let registry = registry();
    comparison(
        pipeline,
        proposal,
        TaskType::Classification,
        is_split,
        keeps_train,
        |operator| registry.get(operator),
    )
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
            "id": "cv_ml_linear_model", "operator": "sprisk.ml.cross_validate@2.0.0",
            "params": {
                "candidate": "sprisk.ml.linear_model@1.0.0",
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
            "metric": "balanced_accuracy",
            "complexity": { "ml_dummy_baseline": 0, "ml_linear_model": 1 }
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
    // Shuffled folds would validate on earlier rows, or on groups also fit on (ADR-0047).
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
        (
            "sprisk.validation.stratified_split@1.0.0",
            json!({}),
            "has no fold rule; compare knows random, temporal and group splits",
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
