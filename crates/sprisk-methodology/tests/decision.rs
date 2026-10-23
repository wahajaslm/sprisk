#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{
    DecisionProposal, Node, PipelineVersion, QuestionVersion, RuleDecision, SelectionMetric,
    TaskType, parse,
};
use sprisk_methodology::ResolveError;
use sprisk_methodology::{
    Comparison, RuleCatalog, Scoring, Stamp, candidate_facts, candidates, comparison, facts,
    flow_facts, input_facts, join_facts, key_columns, observation, preparation_comparison,
    profile_facts, proposal, result_facts, target_facts, train_rows_source, unread_sources,
    with_node_before, without_node,
};
use sprisk_registry::Registry;

const SPLIT: &str = "methodology.supervised.data_split@1.0.0";

fn catalog() -> RuleCatalog {
    RuleCatalog::load_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology"),
        [],
    )
    .unwrap()
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
        &[],
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

fn temporal_over(params: Value) -> Value {
    let catalog = catalog();
    let rule = catalog.rule(SPLIT).unwrap();
    let mut flow = serde_json::to_value(pipeline()).unwrap();
    flow["nodes"][0] = json!({ "id": "split", "operator": "sprisk.validation.group_split@1.0.0",
                               "params": params });
    let flow: PipelineVersion = parse(&flow.to_string()).unwrap();
    let decided: RuleDecision = parse(
        &json!({
            "schema_version": "sprisk.rule_decision/v1",
            "rule": SPLIT,
            "recommended_alternative_id": "temporal",
            "alternatives": [{ "id": "temporal", "applicability": "applicable", "reason": "Time.",
                               "params": { "time_column": "signup_date", "test_fraction": 0.2 } }],
            "evidence": []
        })
        .to_string(),
    )
    .unwrap();
    let registry = registry();
    let built = proposal(
        rule,
        &decided,
        &question(),
        &flow,
        "split",
        &registry.operators().collect::<Vec<_>>(),
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-15T10:00:00Z",
        },
    )
    .unwrap();
    serde_json::to_value(&built.alternatives[0].effect).unwrap()
}

#[test]
fn a_replaced_split_takes_only_the_settings_the_rule_decided() {
    // A split rule states every setting it means; an old one, such as an unconfirmed group
    // column, must not come back.
    let effect =
        temporal_over(json!({ "group_column": "customer", "test_fraction": 0.3, "seed": 7 }));
    assert_eq!(
        effect["params"],
        json!({ "time_column": "signup_date", "test_fraction": 0.2 })
    );
}

#[test]
fn a_model_replaced_by_an_unregistered_model_is_an_error_not_a_step_without_settings() {
    let catalog = catalog();
    let rule = catalog
        .rule("methodology.supervised.interpretability_requirement@1.0.0")
        .unwrap();
    let decided: RuleDecision = parse(
        &json!({
            "schema_version": "sprisk.rule_decision/v1",
            "rule": "methodology.supervised.interpretability_requirement@1.0.0",
            "recommended_alternative_id": "interpretable_only",
            "alternatives": [{ "id": "interpretable_only", "applicability": "applicable",
                               "reason": "High.", "params": {} }],
            "evidence": []
        })
        .to_string(),
    )
    .unwrap();
    let registry = registry();
    let without_linear: Vec<_> = registry
        .operators()
        .filter(|o| !o.id.to_string().starts_with("sprisk.ml.linear_model@"))
        .collect();
    let forest = flow(
        &[
            ("split", "validation.random_split"),
            ("model", "ml.random_forest@3.0.0"),
        ],
        &[("split.train", "model.train")],
    );
    let err = proposal(
        rule,
        &decided,
        &question(),
        &forest,
        "model",
        &without_linear,
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-15T10:00:00Z",
        },
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("sprisk.ml.linear_model@3.0.0"),
        "{err}"
    );
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
        &[],
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
                { "name": "city", "data_type": "String", "missing": 0, "distinct": 12, "missing_by_band": [],
                  "word_share": 0.75 },
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
    assert_eq!(facts["column.city.word_share"], 0.75);
    assert!(facts.get("column.income.word_share").is_none());
    assert!(facts.get("column.city.skewness").is_none());
    assert!(facts.keys().all(|k| !k.starts_with("column.other.")));
}

#[test]
fn input_facts_give_the_structure_of_every_column_and_no_statistics() {
    let profile = parse(
        &json!({
            "total_rows": 200, "total_columns": 2, "profiled_rows": 200, "band_rows": 5,
            "duplicate_rows": 4,
            "columns": [
                { "name": "income", "data_type": "Float64", "missing": 50, "distinct": 140,
                  "missing_by_band": [], "skewness": 2.5 },
                { "name": "age", "data_type": "String", "missing": 0, "distinct": 40,
                  "missing_by_band": [], "numeric_share": 0.98, "leading_zero_values": 0,
                  "word_share": 0.25, "html_share": 0.5,
                  "case_variants": 3, "accent_variants": 1,
                  "unconverted": ["?", "n/a"] }
            ],
            "correlation": { "columns": [], "pairs": [] }
        })
        .to_string(),
    )
    .unwrap();
    let facts = input_facts(&profile);

    assert_eq!(facts["input.rows"], 200);
    assert_eq!(facts["input.duplicate_rows"], 4);
    assert_eq!(facts["input.column.income.data_type"], "Float64");
    assert_eq!(facts["input.column.age.numeric_share"], 0.98);
    assert_eq!(facts["input.column.age.word_share"], 0.25);
    assert_eq!(facts["input.column.age.html_share"], 0.5);
    assert_eq!(facts["input.column.age.unconverted"], json!(["?", "n/a"]));
    assert_eq!(facts["input.column.age.leading_zero_values"], 0);
    assert_eq!(facts["input.column.age.distinct"], 40);
    assert_eq!(facts["input.column.age.case_variants"], 3);
    assert_eq!(facts["input.column.age.accent_variants"], 1);
    assert!(
        facts
            .keys()
            .all(|k| !k.contains("skewness") && !k.contains("missing"))
    );
}

#[test]
fn target_facts_describe_the_target_column_of_the_train_rows() {
    let profile = parse(
        &json!({
            "total_rows": 100, "total_columns": 2, "profiled_rows": 100, "band_rows": 5,
            "columns": [
                { "name": "churned", "data_type": "Int64", "missing": 0, "distinct": 2,
                  "missing_by_band": [], "rarest_share": 0.08 },
                { "name": "age", "data_type": "Int64", "missing": 0, "distinct": 50, "missing_by_band": [] }
            ],
            "correlation": { "columns": [], "pairs": [] }
        })
        .to_string(),
    )
    .unwrap();
    let facts = target_facts(&profile, "churned");
    assert_eq!(facts["target.data_type"], "Int64");
    assert_eq!(facts["target.distinct"], 2);
    assert_eq!(facts["target.rarest_share"], 0.08);
    assert!(target_facts(&profile, "absent").is_empty());
    for read in ["target.distinct", "target.rarest_share"] {
        assert!(facts::is_known(read), "{read}");
        assert!(facts::needs_train_rows([read].into_iter()), "{read}");
    }
}

#[test]
fn input_facts_are_known_and_need_the_rows_before_the_split_not_train_rows() {
    for read in [
        "input.rows",
        "input.duplicate_rows",
        "input.column.*.unconverted",
    ] {
        assert!(facts::is_known(read), "{read}");
        assert!(facts::needs_input_rows([read].into_iter()), "{read}");
        assert!(!facts::needs_train_rows([read].into_iter()), "{read}");
    }
    assert!(!facts::needs_input_rows(
        ["rows", "question.target"].into_iter()
    ));
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
fn a_scale_step_upstream_of_a_random_forest_reads_trees() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest@3.0.0"),
            ("base", "ml.dummy_baseline@3.0.0"),
            ("eval", "ml.evaluate@2.0.0"),
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
}

#[test]
fn models_of_several_families_are_all_listed() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest@3.0.0"),
            ("lin", "ml.linear_model@3.0.0"),
        ],
        &[("scale.train", "rf.train"), ("scale.train", "lin.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(
        facts["flow.model_families"]["value"],
        "linear, tree_ensemble"
    );
}

#[test]
fn a_clustering_step_beside_a_forest_lists_both_families() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest@3.0.0"),
            ("km", "clustering.kmeans"),
        ],
        &[("scale.train", "rf.train"), ("scale.train", "km.data")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(
        facts["flow.model_families"]["value"],
        "distance_based, tree_ensemble"
    );
    assert_eq!(facts["flow.models_hidden"]["value"], "none");
}

#[test]
fn a_model_reached_through_other_steps_counts_but_one_upstream_does_not() {
    let pipeline = flow(
        &[
            ("lin", "ml.linear_model@3.0.0"),
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
}

#[test]
fn models_that_ignore_their_features_read_featureless() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("base", "ml.dummy_baseline@3.0.0"),
        ],
        &[("scale.train", "base.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_families"]["value"], "featureless");
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
            ("lin", "ml.linear_model@3.0.0"),
        ],
        &[("scale.train", "code.data"), ("code.data", "lin.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert!(facts.get("flow.model_families").is_none());
    assert_eq!(facts["flow.models_hidden"]["value"], "all");
}

#[test]
fn a_hidden_model_beside_a_seen_one_means_some_are_hidden() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest@3.0.0"),
            ("code", "code.python@1.1.0"),
            ("lin", "ml.linear_model@3.0.0"),
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
}

#[test]
fn a_step_with_no_model_after_it_hides_nothing() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("summary", "profile.summarize"),
            ("rf", "ml.random_forest@3.0.0"),
        ],
        &[("scale.train", "summary.data"), ("scale.train", "rf.train")],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.model_families"]["value"], "tree_ensemble");
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
            ("lin", "ml.linear_model@3.0.0"),
        ],
        &[("clip.train", "db.data"), ("db.data", "lin.train")],
    );
    let facts = facts_of(&pipeline, "clip");
    assert_eq!(facts["flow.model_families"]["value"], "density_based");
    assert_eq!(facts["flow.models_hidden"]["value"], "some");
}

#[test]
fn a_model_reached_both_directly_and_through_a_code_step_counts_once_as_hidden() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("code", "code.python@1.1.0"),
            ("lin", "ml.linear_model@3.0.0"),
        ],
        &[
            ("scale.train", "lin.train"),
            ("scale.train", "code.data"),
            ("code.data", "lin.train"),
        ],
    );
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["flow.models_hidden"]["value"], "all");
}

#[test]
fn a_model_step_does_not_count_itself() {
    let pipeline = flow(&[("km", "clustering.kmeans")], &[]);
    let facts = facts_of(&pipeline, "km");
    assert!(facts.get("flow.model_families").is_none(), "{facts:?}");
    assert!(facts.get("flow.models_hidden").is_none(), "{facts:?}");
}

fn with_criteria(criteria: Value) -> QuestionVersion {
    let mut question = serde_json::to_value(question()).unwrap();
    question["acceptance_criteria"] = criteria;
    parse(&question.to_string()).unwrap()
}

#[test]
fn the_acceptance_criteria_are_one_fact_with_the_weakest_origin() {
    let catalog = catalog();
    let rule = catalog.rule("methodology.common.objective@1.0.0").unwrap();
    let observe = |criteria: Value| {
        let observed = observation(
            rule,
            &with_criteria(criteria),
            Default::default(),
            Default::default(),
        );
        serde_json::to_value(observed.unwrap()).unwrap()["facts"].clone()
    };
    let facts = observe(json!([
        { "value": "PR-AUC at least 0.4", "origin": "explicit" },
        { "value": "beats the baseline", "origin": "inferred" }
    ]));
    assert_eq!(
        facts["question.acceptance_criteria"],
        json!({ "value": "PR-AUC at least 0.4; beats the baseline", "origin": "inferred" })
    );
    assert!(
        observe(json!([]))
            .get("question.acceptance_criteria")
            .is_none()
    );
}

#[test]
fn an_observation_carries_flow_facts_beside_the_question_facts() {
    let catalog = catalog();
    let rule = catalog
        .rule("methodology.supervised.outlier_treatment@2.0.0")
        .unwrap();
    let pipeline = flow(
        &[("scale", "clean.scale"), ("rf", "ml.random_forest@3.0.0")],
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

const SCALING: &str = "methodology.supervised.feature_scaling@4.0.0";

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
            ("rf", "ml.random_forest@3.0.0"),
            ("eval", "ml.evaluate@2.0.0"),
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
            &[],
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
            ("rf", "ml.random_forest@3.0.0"),
            ("eval", "ml.evaluate@2.0.0"),
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

const ENCODING: &str = "methodology.supervised.categorical_encoding@3.0.0";

/// The encoding rule picking one-hot for `purpose`.
fn one_hot_decision() -> RuleDecision {
    parse(
        &json!({
            "schema_version": "sprisk.rule_decision/v1",
            "rule": ENCODING,
            "recommended_alternative_id": "one_hot_encoding",
            "alternatives": [{ "id": "one_hot_encoding", "applicability": "applicable", "reason": "r",
                               "params": { "columns": ["purpose"] } }],
            "evidence": []
        })
        .to_string(),
    )
    .unwrap()
}

/// The encoding rule's one-hot pick for the forest of `pipeline`, as a proposal's alternative.
fn one_hot_for_forest(pipeline: &PipelineVersion) -> Value {
    let catalog = catalog();
    let built = proposal(
        catalog.rule(ENCODING).unwrap(),
        &one_hot_decision(),
        &question(),
        pipeline,
        "rf",
        &[],
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-22T10:00:00Z",
        },
    )
    .unwrap();
    serde_json::to_value(built).unwrap()["alternatives"][0].clone()
}

#[test]
fn an_applicable_alternative_that_adds_a_step_gets_an_insert_node_effect_before_its_step() {
    assert_eq!(
        one_hot_for_forest(&before_forest())["effect"],
        json!({ "kind": "insert_node", "node_id": "categories", "operator": "sprisk.clean.encode@1.0.0",
                "params": { "columns": ["purpose"] }, "before": "rf" })
    );
}

#[test]
fn leaving_text_out_sets_the_models_exclude_and_keeps_its_other_settings() {
    let mut pipeline = serde_json::to_value(before_forest()).unwrap();
    pipeline["nodes"][2]["params"] = json!({ "target": "churned", "exclude": ["id"] });
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let decided: RuleDecision = parse(
        &json!({
            "schema_version": "sprisk.rule_decision/v1",
            "rule": ENCODING,
            "recommended_alternative_id": "leave_out_columns",
            "alternatives": [{ "id": "leave_out_columns", "applicability": "applicable", "reason": "r",
                               "params": { "exclude": ["id", "title"] } }],
            "evidence": []
        })
        .to_string(),
    )
    .unwrap();
    let catalog = catalog();
    let built = proposal(
        catalog.rule(ENCODING).unwrap(),
        &decided,
        &question(),
        &pipeline,
        "rf",
        &[],
        Stamp {
            id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            created_at: "2026-10-22T10:00:00Z",
        },
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(built).unwrap()["alternatives"][0]["effect"],
        json!({ "kind": "replace_node", "node_id": "rf", "operator": "sprisk.ml.random_forest@3.0.0",
                "params": { "target": "churned", "exclude": ["id", "title"] } })
    );
}

#[test]
fn an_insert_step_with_no_place_or_id_for_the_step_is_refused_not_ignored() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology/supervised/rules");
    for (drop, kept) in [
        ("      node_id: categories\n", "node_id"),
        ("      placement: before\n", "placement"),
    ] {
        let packs = tempfile::tempdir().unwrap();
        let rule = packs.path().join("supervised/rules/categorical_encoding");
        std::fs::create_dir_all(&rule).unwrap();
        let manifest =
            std::fs::read_to_string(root.join("categorical_encoding/rule.yaml")).unwrap();
        assert!(manifest.contains(drop), "{drop}");
        std::fs::write(rule.join("rule.yaml"), manifest.replacen(drop, "", 1)).unwrap();
        std::fs::copy(
            root.join("categorical_encoding/rule.py"),
            rule.join("rule.py"),
        )
        .unwrap();
        let catalog = RuleCatalog::load_dir(packs.path(), []).unwrap();
        let err = proposal(
            catalog.rule(ENCODING).unwrap(),
            &one_hot_decision(),
            &question(),
            &before_forest(),
            "rf",
            &[],
            Stamp {
                id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
                created_at: "2026-10-22T10:00:00Z",
            },
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("one_hot_encoding"),
            "{kept}: {err}"
        );
    }
}

#[test]
fn a_step_added_under_a_taken_id_gets_the_first_free_suffix() {
    let mut pipeline = serde_json::to_value(before_forest()).unwrap();
    pipeline["nodes"][1]["id"] = json!("categories");
    pipeline["edges"] = json!([]);
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    assert_eq!(
        one_hot_for_forest(&pipeline)["effect"]["node_id"],
        "categories_2"
    );
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
            ("eval", "ml.evaluate@2.0.0"),
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
            ("eval", "ml.evaluate@2.0.0"),
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
            ("eval", "ml.evaluate@2.0.0"),
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

#[test]
fn the_steps_own_text_settings_are_facts_so_a_rule_knows_what_it_does_now() {
    let mut pipeline = serde_json::to_value(before_forest()).unwrap();
    pipeline["nodes"][1]["params"] =
        json!({ "columns": ["income", "age"], "method": "zero", "seed": 3, "drop": [] });
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let facts = facts_of(&pipeline, "scale");
    assert_eq!(facts["step.method"]["value"], "zero");
    assert_eq!(facts["step.method"]["origin"], "explicit");
    // A list of text is one fact, sorted and joined by ", ", like the flow's facts.
    assert_eq!(facts["step.columns"]["value"], "age, income");
    assert!(facts.get("step.seed").is_none());
    assert!(facts.get("step.drop").is_none());
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
    assert_eq!(observed["facts"]["flow.models_hidden"]["value"], "none");
    // A column name may hold dots; the pattern still matches it.
    assert_eq!(observed["profile"], json!({ "column.a.b.kurtosis": 2.0 }));
}

#[test]
fn every_flow_fact_in_the_catalog_is_one_rust_sends() {
    let pipeline = flow(
        &[
            ("scale", "clean.scale"),
            ("rf", "ml.random_forest@3.0.0"),
            ("summary", "profile.summarize"),
        ],
        &[("scale.train", "rf.train"), ("scale.train", "summary.data")],
    );
    // flow.scaled_columns is sent for a model step only.
    let sent: std::collections::BTreeSet<String> = ["scale", "rf"]
        .iter()
        .flat_map(|step| facts_of(&pipeline, step).into_iter().map(|(k, _)| k))
        .filter(|k| k.starts_with("flow."))
        .collect();
    let mut catalog: Vec<&str> = sprisk_methodology::facts::FACTS
        .iter()
        .copied()
        .filter(|f| f.starts_with("flow."))
        .collect();
    catalog.sort();
    assert_eq!(sent.iter().collect::<Vec<_>>(), catalog);
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
            "id": "methodology.supervised.model_baseline_selection@2.1.0",
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
        "rule": "methodology.supervised.model_baseline_selection@2.1.0",
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
            ("model", "ml.linear_model@3.0.0"),
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
    let built = proposal(
        &shortlist_rule(),
        &shortlist_decision(json!(["ml_dummy_baseline", "ml_linear_model"]), None),
        &question(),
        &model_flow(),
        "model",
        &registry.operators().collect::<Vec<_>>(),
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
    assert_eq!(forest["label"], "sprisk.ml.random_forest@3.0.0");
    assert_eq!(
        forest["effect"]["operator"],
        "sprisk.ml.random_forest@3.0.0"
    );
    assert_eq!(
        forest["effect"]["params"],
        json!({ "target": "churned", "features": ["age", "plan"], "task": "classification" })
    );
}

#[test]
fn a_shortlist_decision_must_shortlist_and_not_recommend() {
    let registry = registry();
    let build = |decided: RuleDecision| {
        proposal(
            &shortlist_rule(),
            &decided,
            &question(),
            &model_flow(),
            "model",
            &registry.operators().collect::<Vec<_>>(),
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
            &[],
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
    let linear = registry.get("sprisk.ml.linear_model@3.0.0").unwrap();
    let mut newer = linear.clone();
    newer.id = parse("\"sprisk.ml.linear_model@3.0.0\"").unwrap();
    let err = candidates(TaskType::Classification, [linear, &newer].into_iter()).unwrap_err();
    assert!(err.to_string().contains("ml_linear_model"), "{err}");
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
            ("eval", "ml.evaluate@2.0.0"),
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
    proposal(
        &shortlist_rule(),
        &shortlist_decision(shortlist, None),
        &question(),
        pipeline,
        "model",
        &registry.operators().collect::<Vec<_>>(),
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
        proposal,
        Scoring {
            task: TaskType::Classification,
            stated,
        },
        is_split,
        keeps_train,
        |operator| registry.get(operator),
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
            "not_compared": [{ "id": "ml_random_forest", "reason": "Not on the shortlist: Too few rows to trust." }]
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

const MISSINGNESS: &str = "methodology.supervised.missingness@4.0.0";

/// A recommend proposal for `step` of `pipeline`, built by hand: `alternatives` as the API
/// stores them, effects included.
fn recommending(
    pipeline: &PipelineVersion,
    rule: &str,
    step: &str,
    recommended: &str,
    alternatives: Value,
) -> DecisionProposal {
    parse(
        &json!({
            "schema_version": "sprisk.decision_proposal/v1",
            "id": "mpr_01JABCDEFGHJKMNPQRSTVWXYZ7",
            "rule": rule,
            "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "pipeline_version_id": pipeline.id,
            "subject_node_id": step,
            "evidence": [],
            "alternatives": alternatives,
            "recommended_alternative_id": recommended,
            "fingerprint": format!("sha256:{}", "0".repeat(64)),
            "created_at": "2026-10-15T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap()
}

fn replace(id: &str, step: &str, operator: &str, params: Value) -> Value {
    json!({
        "id": id, "label": id, "description": "d", "applicability": "applicable", "reason": "r",
        "effect": { "kind": "replace_node", "node_id": step, "operator": operator, "params": params }
    })
}

fn removing(id: &str, step: &str) -> Value {
    json!({
        "id": id, "label": id, "description": "d", "applicability": "applicable", "reason": "r",
        "effect": { "kind": "remove_node", "node_id": step }
    })
}

fn unavailable(id: &str, applicability: &str, reason: &str) -> Value {
    json!({ "id": id, "label": id, "description": "d", "applicability": applicability, "reason": reason })
}

fn scale_alternatives() -> Value {
    json!([
        removing("no_scaling", "scale"),
        replace(
            "robust_scaling",
            "scale",
            "sprisk.clean.scale@1.0.0",
            json!({ "columns": ["age"], "method": "robust" })
        ),
        replace(
            "standard_scaling",
            "scale",
            "sprisk.clean.scale@1.0.0",
            json!({ "columns": ["age"], "method": "z_score" })
        ),
        unavailable(
            "maxabs_scaling_sparse",
            "not_applicable",
            "The scale step has no max-abs method."
        ),
    ])
}

fn compare_preparation(
    pipeline: &PipelineVersion,
    rule: &str,
    proposal: &DecisionProposal,
) -> Result<Comparison, ResolveError> {
    let registry = registry();
    let catalog = catalog();
    let fits = |n: &Node| {
        registry
            .get(n.operator.as_str())
            .is_some_and(|o| o.fits_on_train == Some(true))
    };
    preparation_comparison(
        pipeline,
        proposal,
        catalog.rule(rule).unwrap(),
        Scoring {
            task: TaskType::Classification,
            stated: None,
        },
        is_split,
        fits,
        |operator| registry.get(operator),
    )
}

fn select_params(built: &Comparison) -> Value {
    let select = built
        .nodes
        .iter()
        .find(|n| n.id.as_str() == "select_model")
        .unwrap();
    serde_json::to_value(select).unwrap()["params"].clone()
}

#[test]
fn a_preparation_comparison_scores_each_way_of_doing_the_step_with_the_flows_model() {
    let pipeline = evaluated_flow();
    let proposal = recommending(
        &pipeline,
        SCALING,
        "scale",
        "standard_scaling",
        scale_alternatives(),
    );
    let built = compare_preparation(&pipeline, SCALING, &proposal).unwrap();

    let ids: Vec<&str> = built.nodes.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "load",
            "split",
            "cv_no_scaling",
            "cv_robust_scaling",
            "cv_standard_scaling",
            "select_model"
        ]
    );
    let cv = |id: &str| {
        let node = built.nodes.iter().find(|n| n.id.as_str() == id).unwrap();
        serde_json::to_value(node).unwrap()["params"].clone()
    };
    // The model is the flow's, unchanged; only the step's place in `prepare` differs.
    for id in ["cv_no_scaling", "cv_robust_scaling", "cv_standard_scaling"] {
        assert_eq!(cv(id)["candidate"], "sprisk.ml.linear_model@3.0.0", "{id}");
        assert_eq!(
            cv(id)["candidate_params"],
            json!({ "target": "churned", "features": ["age", "plan"], "task": "classification" })
        );
        assert_eq!(cv(id)["repeats"], 10);
    }
    assert_eq!(cv("cv_no_scaling")["prepare"], json!([]));
    assert_eq!(
        cv("cv_robust_scaling")["prepare"],
        json!([{ "operator": "sprisk.clean.scale@1.0.0", "params": { "columns": ["age"], "method": "robust" } }])
    );
    assert_eq!(
        select_params(&built),
        json!({
            "trials": ["no_scaling", "robust_scaling", "standard_scaling"],
            "baseline": "standard_scaling", "baseline_role": "reference",
            "metric": "balanced_accuracy",
            "complexity": { "no_scaling": 0, "robust_scaling": 1, "standard_scaling": 1 },
            "not_compared": [{ "id": "maxabs_scaling_sparse", "reason": "Not applicable here: The scale step has no max-abs method." }]
        })
    );
    for edge in &built.edges {
        let (step, port) = edge.from.step_and_port();
        assert!(
            step != "split" || port == "train",
            "{} reads split.{port}",
            edge.to.as_str()
        );
    }
}

/// load -> split -> impute -> model -> evaluate.
fn imputed_flow() -> PipelineVersion {
    let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
    pipeline["nodes"][2]["id"] = json!("impute");
    pipeline["nodes"][2]["operator"] = json!("sprisk.clean.impute@1.0.0");
    pipeline["nodes"][2]["params"] = json!({ "columns": ["age"], "method": "zero" });
    pipeline["edges"] = json!([
        { "from": "load.data", "to": "split.data" },
        { "from": "split.train", "to": "impute.train" },
        { "from": "split.test", "to": "impute.test" },
        { "from": "impute.train", "to": "model.train" },
        { "from": "model.model", "to": "eval.model" },
        { "from": "impute.test", "to": "eval.test" }
    ]);
    parse(&pipeline.to_string()).unwrap()
}

fn impute_alternatives() -> Value {
    json!([
        replace(
            "drop_rows",
            "impute",
            "sprisk.clean.drop_missing@1.0.0",
            json!({ "columns": ["age"] })
        ),
        replace(
            "impute_median",
            "impute",
            "sprisk.clean.impute@1.0.0",
            json!({ "columns": ["age"], "method": "median" })
        ),
        replace(
            "impute_mean",
            "impute",
            "sprisk.clean.impute@1.0.0",
            json!({ "columns": ["age"], "method": "mean" })
        ),
        unavailable(
            "impute_mode",
            "not_applicable",
            "The impute step fills numbers only (ADR-0042)."
        ),
        unavailable(
            "drop_column",
            "not_applicable",
            "No column is mostly empty."
        ),
        unavailable("pass_through", "needs_fact", "Confirm the target first."),
        unavailable("impute_knn", "applicable", "r"),
        // An effect does not make an alternative the rule rejects measurable.
        json!({
            "id": "impute_zero", "label": "Zero", "description": "d", "applicability": "not_applicable",
            "reason": "Zero may mean none here.",
            "effect": { "kind": "replace_node", "node_id": "impute", "operator": "sprisk.clean.impute@1.0.0",
                        "params": { "columns": ["age"], "method": "zero" } }
        }),
    ])
}

#[test]
fn alternatives_that_cannot_be_refit_within_each_fold_are_not_compared_and_say_why() {
    let pipeline = imputed_flow();
    let proposal = recommending(
        &pipeline,
        MISSINGNESS,
        "impute",
        "impute_mean",
        impute_alternatives(),
    );
    let built = compare_preparation(&pipeline, MISSINGNESS, &proposal).unwrap();

    let params = select_params(&built);
    assert_eq!(params["trials"], json!(["impute_median", "impute_mean"]));
    let why: Vec<(String, String)> = params["not_compared"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| {
            (
                n["id"].as_str().unwrap().to_owned(),
                n["reason"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    let expected = [
        (
            "drop_rows",
            "sprisk.clean.drop_missing@1.0.0 does not fit on the train rows and keep train and test apart, so it cannot be refit within each fold.",
        ),
        (
            "impute_mode",
            "Not applicable here: The impute step fills numbers only (ADR-0042).",
        ),
        (
            "drop_column",
            "It acts before the split, on train and test rows together, so it cannot be refit within each fold.",
        ),
        (
            "pass_through",
            "Needs a fact first: Confirm the target first.",
        ),
        ("impute_knn", "The rule builds no step for it yet."),
        (
            "impute_zero",
            "Not applicable here: Zero may mean none here.",
        ),
    ];
    let expected: Vec<(String, String)> = expected
        .iter()
        .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
        .collect();
    assert_eq!(why, expected);
}

#[test]
fn a_recommendation_that_cannot_be_measured_leaves_nothing_to_compare() {
    let pipeline = imputed_flow();
    let proposal = recommending(
        &pipeline,
        MISSINGNESS,
        "impute",
        "drop_rows",
        impute_alternatives(),
    );
    let err = compare_preparation(&pipeline, MISSINGNESS, &proposal).unwrap_err();
    assert!(matches!(err, ResolveError::NothingToCompare(_)), "{err}");
    assert!(
        err.to_string().contains("the recommendation drop_rows cannot be measured here: sprisk.clean.drop_missing@1.0.0 does not fit"),
        "{err}"
    );
}

#[test]
fn a_recommendation_with_no_measurable_alternative_leaves_nothing_to_compare() {
    let pipeline = evaluated_flow();
    let alternatives = json!([
        replace(
            "standard_scaling",
            "scale",
            "sprisk.clean.scale@1.0.0",
            json!({ "columns": ["age"], "method": "z_score" })
        ),
        unavailable("no_scaling", "not_applicable", "Scaling matters."),
    ]);
    let proposal = recommending(
        &pipeline,
        SCALING,
        "scale",
        "standard_scaling",
        alternatives,
    );
    let err = compare_preparation(&pipeline, SCALING, &proposal).unwrap_err();
    assert!(matches!(err, ResolveError::NothingToCompare(_)), "{err}");
    assert!(
        err.to_string()
            .contains("only the recommendation standard_scaling can be measured here"),
        "{err}"
    );
}

#[test]
fn a_step_that_feeds_no_model_through_train_rows_cannot_be_compared() {
    // The scale step's test rows reach the model's train input: no train-rows path from it.
    let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
    pipeline["edges"][3] = json!({ "from": "split.train", "to": "model.train" });
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let proposal = recommending(
        &pipeline,
        SCALING,
        "scale",
        "standard_scaling",
        scale_alternatives(),
    );
    let err = compare_preparation(&pipeline, SCALING, &proposal).unwrap_err();
    assert!(matches!(err, ResolveError::NothingToCompare(_)), "{err}");
    assert!(
        err.to_string()
            .contains("step scale is not between a split and a model"),
        "{err}"
    );
}

#[test]
fn a_preparation_comparison_needs_a_recommendation() {
    let pipeline = evaluated_flow();
    let mut proposal = serde_json::to_value(recommending(
        &pipeline,
        SCALING,
        "scale",
        "standard_scaling",
        scale_alternatives(),
    ))
    .unwrap();
    proposal
        .as_object_mut()
        .unwrap()
        .remove("recommended_alternative_id");
    let proposal: DecisionProposal = parse(&proposal.to_string()).unwrap();
    let err = compare_preparation(&pipeline, SCALING, &proposal).unwrap_err();
    assert!(matches!(err, ResolveError::Selection(_)), "{err}");
    assert!(
        err.to_string()
            .contains("recommends nothing to compare against"),
        "{err}"
    );
}

#[test]
fn a_step_that_prepares_two_models_is_compared_for_neither() {
    let mut pipeline = serde_json::to_value(evaluated_flow()).unwrap();
    pipeline["nodes"].as_array_mut().unwrap().push(json!({
        "id": "forest", "operator": "sprisk.ml.random_forest@3.0.0",
        "params": { "target": "churned", "features": ["age"], "task": "classification" }
    }));
    pipeline["edges"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "from": "scale.train", "to": "forest.train" }));
    let pipeline: PipelineVersion = parse(&pipeline.to_string()).unwrap();
    let proposal = recommending(
        &pipeline,
        SCALING,
        "scale",
        "standard_scaling",
        scale_alternatives(),
    );
    let err = compare_preparation(&pipeline, SCALING, &proposal).unwrap_err();
    assert!(matches!(err, ResolveError::NothingToCompare(_)), "{err}");
    assert!(
        err.to_string()
            .contains("step scale prepares the train rows of 2 models"),
        "{err}"
    );
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

    let pipeline = with_own_code(imputed_flow(), "model");
    let proposal = recommending(
        &pipeline,
        MISSINGNESS,
        "impute",
        "impute_mean",
        impute_alternatives(),
    );
    let err = compare_preparation(&pipeline, MISSINGNESS, &proposal).unwrap_err();
    assert!(
        err.to_string().contains("step model runs its own code"),
        "{err}"
    );
}

#[test]
fn the_step_being_compared_may_run_its_own_code_since_every_choice_replaces_it() {
    let pipeline = with_own_code(evaluated_flow(), "scale");
    let proposal = recommending(
        &pipeline,
        SCALING,
        "scale",
        "standard_scaling",
        scale_alternatives(),
    );
    assert!(compare_preparation(&pipeline, SCALING, &proposal).is_ok());
}

const THRESHOLD: &str = "methodology.supervised.decision_threshold@1.0.0";

fn costed_question() -> QuestionVersion {
    let mut question = serde_json::to_value(question()).unwrap();
    question["costs"] = json!({
        "value": { "positive": "bad", "false_negative": 5.0, "false_positive": 1.0 },
        "origin": "explicit"
    });
    parse(&question.to_string()).unwrap()
}

fn forest_flow(params: Value) -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [{ "id": "model", "operator": "sprisk.ml.random_forest@3.0.0", "params": params }],
            "edges": [],
            "created_at": "2026-10-15T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap()
}

fn threshold_proposal(decided: Value, pipeline: &PipelineVersion) -> Result<Value, ResolveError> {
    let catalog = catalog();
    let rule = catalog.rule(THRESHOLD).unwrap();
    let decided: RuleDecision = parse(
        &json!({
            "schema_version": "sprisk.rule_decision/v1", "rule": THRESHOLD,
            "recommended_alternative_id": "cost_optimal_threshold",
            "alternatives": decided, "evidence": []
        })
        .to_string(),
    )
    .unwrap();
    let stamp = Stamp {
        id: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
        created_at: "2026-10-15T10:00:00Z",
    };
    let built = proposal(
        rule,
        &decided,
        &costed_question(),
        pipeline,
        "model",
        &[],
        stamp,
    )?;
    Ok(serde_json::to_value(built).unwrap())
}

#[test]
fn an_observation_carries_the_question_s_costs_as_text_facts_with_their_origin() {
    let catalog = catalog();
    let rule = catalog.rule(THRESHOLD).unwrap();
    let observed = serde_json::to_value(
        observation(
            rule,
            &costed_question(),
            Default::default(),
            Default::default(),
        )
        .unwrap(),
    )
    .unwrap();
    let facts = &observed["facts"];
    assert_eq!(
        facts["question.costs.positive"],
        json!({ "value": "bad", "origin": "explicit" })
    );
    assert_eq!(facts["question.costs.false_negative"]["value"], "5.0");
    assert_eq!(facts["question.costs.false_positive"]["value"], "1.0");
}

#[test]
fn updating_estimator_params_keeps_the_model_and_sets_or_drops_only_the_declared_params() {
    let old = json!({ "positive": "bad", "false_negative": 2.0, "false_positive": 1.0 });
    let flow = forest_flow(
        json!({ "target": "risk", "features": ["x"], "task": "classification", "n_estimators": 50, "costs": old }),
    );
    let costs = json!({ "positive": "bad", "false_negative": 5.0, "false_positive": 1.0 });
    let built = threshold_proposal(
        json!([
            { "id": "cost_optimal_threshold", "applicability": "applicable", "reason": "Costs.",
              "params": { "costs": costs } },
            { "id": "default_half", "applicability": "applicable", "reason": "Same.", "params": {} }
        ]),
        &flow,
    )
    .unwrap();
    let kept = json!({ "target": "risk", "features": ["x"], "task": "classification", "n_estimators": 50 });
    let mut set = kept.clone();
    set["costs"] = costs;
    assert_eq!(
        built["alternatives"][0]["effect"],
        json!({ "kind": "replace_node", "node_id": "model",
                "operator": "sprisk.ml.random_forest@3.0.0", "params": set })
    );
    assert_eq!(built["alternatives"][1]["effect"]["params"], kept);
}

#[test]
fn a_decision_setting_a_param_its_action_does_not_declare_is_refused() {
    let flow =
        forest_flow(json!({ "target": "risk", "features": ["x"], "task": "classification" }));
    let err = threshold_proposal(
        json!([
            { "id": "cost_optimal_threshold", "applicability": "applicable", "reason": "Costs.",
              "params": { "n_estimators": 10 } },
            { "id": "default_half", "applicability": "applicable", "reason": "Same.", "params": {} }
        ]),
        &flow,
    )
    .unwrap_err();
    assert!(
        err.to_string()
            .contains("cost_optimal_threshold sets n_estimators, which its action does not name"),
        "{err}"
    );
}

fn selection() -> sprisk_contracts::SelectionDecision {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/contract/selection_decision/valid/expected-cost.json");
    parse(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn result_facts_describe_the_step_s_own_model_in_its_model_selection() {
    let facts = result_facts(&selection(), "sprisk.ml.random_forest@1.1.0", 2).unwrap();
    assert_eq!(
        Value::Object(facts),
        json!({
            "cv.metric": "expected_cost",
            "cv.score": 0.888,
            "cv.baseline_score": 0.5,
            "cv.beats_baseline": "yes",
            "cv.selected": "no",
            "cv.looks": 2,
        })
    );
    let winner = result_facts(&selection(), "sprisk.ml.linear_model@3.0.0", 2).unwrap();
    assert_eq!(winner["cv.selected"], json!("yes"));
    for name in [
        "cv.metric",
        "cv.score",
        "cv.baseline_score",
        "cv.beats_baseline",
        "cv.selected",
        "cv.looks",
    ] {
        assert!(facts::is_known(name), "{name}");
        assert!(facts::needs_results([name].into_iter()), "{name}");
        assert!(!facts::needs_train_rows([name].into_iter()), "{name}");
    }
}

#[test]
fn the_baseline_has_no_verdict_against_itself() {
    let facts = result_facts(&selection(), "sprisk.ml.dummy_baseline@1.0.0", 1).unwrap();
    assert!(!facts.contains_key("cv.beats_baseline"));
    assert_eq!(facts["cv.score"], json!(0.5));
}

#[test]
fn a_comparison_of_preparation_gives_no_model_results() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/contract/selection_decision/valid/reference-stands.json");
    let preparation = parse(&std::fs::read_to_string(path).unwrap()).unwrap();
    let err = result_facts(&preparation, "sprisk.ml.linear_model@3.0.0", 1).unwrap_err();
    assert!(err.to_string().contains("preparing"), "{err}");
}

#[test]
fn a_step_whose_model_was_not_compared_has_no_results() {
    let err = result_facts(&selection(), "sprisk.ml.kmeans@1.0.0", 1).unwrap_err();
    assert!(err.to_string().contains("ml_kmeans"), "{err}");
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

#[test]
fn join_facts_count_the_unread_tables_and_give_each_shared_key_s_matches() {
    let matches: sprisk_contracts::KeyMatches = parse(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/contract/key_matches/valid/one-shared-key.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        Value::Object(join_facts(1, Some(&matches))),
        json!({
            "join.unread_tables": 1,
            "join.rows": 84916,
            "join.key.unnamed_0.matched_rows": 84916,
            "join.key.unnamed_0.most_rows_per_key": 1,
        })
    );
    assert_eq!(
        Value::Object(join_facts(2, None)),
        json!({ "join.unread_tables": 2 })
    );
    for name in [
        "join.unread_tables",
        "join.rows",
        "join.key.unnamed_0.matched_rows",
        "join.key.unnamed_0.most_rows_per_key",
    ] {
        assert!(facts::is_known(name), "{name}");
        assert!(facts::needs_join([name].into_iter()), "{name}");
    }
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

#[test]
fn a_model_step_knows_which_columns_scale_steps_before_it_cover() {
    let mut scaled = serde_json::to_value(flow(
        &[
            ("split", "validation.random_split"),
            ("scale", "clean.scale"),
            ("scale_more", "clean.scale"),
            ("lin", "ml.linear_model@3.0.0"),
        ],
        &[
            ("split.train", "scale.train"),
            ("scale.train", "scale_more.train"),
            ("scale_more.train", "lin.train"),
        ],
    ))
    .unwrap();
    scaled["nodes"][1]["params"] = json!({ "columns": ["income", "age"], "method": "z_score" });
    scaled["nodes"][2]["params"] = json!({ "columns": ["age", "debt"], "method": "robust" });
    let scaled: PipelineVersion = parse(&scaled.to_string()).unwrap();
    assert_eq!(
        facts_of(&scaled, "lin")["flow.scaled_columns"]["value"],
        "age, debt, income"
    );
    // Only a model step gets the fact.
    assert!(
        facts_of(&scaled, "scale")
            .get("flow.scaled_columns")
            .is_none()
    );
    let plain = flow(
        &[
            ("split", "validation.random_split"),
            ("lin", "ml.linear_model@3.0.0"),
        ],
        &[("split.train", "lin.train")],
    );
    assert_eq!(
        facts_of(&plain, "lin")["flow.scaled_columns"]["value"],
        "none"
    );
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
            ("eval", "ml.evaluate@2.0.0"),
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
