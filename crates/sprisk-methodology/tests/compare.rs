#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};
use sprisk_contracts::{PipelineVersion, parse};
use sprisk_methodology::{ResolveError, TrialStep, trial_steps};

fn comparison(select_params: Value) -> PipelineVersion {
    let cv = |id: &str, model: &str| {
        json!({ "id": format!("cv_{id}"), "operator": "sprisk.ml.cross_validate@4.0.0",
                "params": { "candidate": model } })
    };
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ2",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                cv("ml_linear_model", "sprisk.ml.linear_model@3.0.0"),
                cv("ml_dummy_baseline", "sprisk.ml.dummy_baseline@3.0.0"),
                { "id": "select_model", "operator": "sprisk.ml.select_model@6.0.0", "params": select_params },
            ],
            "edges": [],
            "created_at": "2026-10-21T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

#[test]
fn trials_are_the_cross_validate_steps_in_the_select_step_s_order() {
    let version = comparison(json!({ "trials": ["ml_dummy_baseline", "ml_linear_model"] }));
    assert_eq!(
        trial_steps(&version).unwrap(),
        [
            TrialStep {
                node_id: "cv_ml_dummy_baseline",
                candidate: "ml_dummy_baseline",
                operator: "sprisk.ml.dummy_baseline@3.0.0",
                settings: serde_json::Map::new(),
            },
            TrialStep {
                node_id: "cv_ml_linear_model",
                candidate: "ml_linear_model",
                operator: "sprisk.ml.linear_model@3.0.0",
                settings: serde_json::Map::new(),
            },
        ]
    );
}

#[test]
fn a_select_step_without_trials_or_a_trial_without_its_step_is_an_error() {
    let no_list = comparison(json!({}));
    assert!(matches!(
        trial_steps(&no_list),
        Err(ResolveError::Selection(_))
    ));
    let missing = comparison(json!({ "trials": ["ml_random_forest"] }));
    assert!(matches!(
        trial_steps(&missing),
        Err(ResolveError::UnknownNode(node)) if node == "cv_ml_random_forest"
    ));
}

#[test]
fn a_tuned_trial_belongs_to_its_candidate_and_carries_its_settings() {
    let version = comparison(json!({
        "trials": ["ml_dummy_baseline", "ml_linear_model"],
        "tuned": { "ml_tuned": ["ml_linear_model"] },
        "settings": { "ml_linear_model": { "c": 0.5 } },
    }));
    let steps = trial_steps(&version).unwrap();
    assert_eq!(steps[0].candidate, "ml_dummy_baseline");
    assert!(steps[0].settings.is_empty());
    assert_eq!(steps[1].candidate, "ml_tuned");
    assert_eq!(
        Value::Object(steps[1].settings.clone()),
        json!({ "c": 0.5 })
    );
}
