//! What decided a flow version, for people: the walk's decisions, the steps each shaped, and
//! the standing of each promise on the version asked about (ADR-0063 slice 5).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sprisk_contracts::{Operator, PipelineVersion, WalkStep, parse};
use sprisk_methodology::RuleCatalog;
use sprisk_methodology::flow_decisions::{flow_decisions, while_head};
use sprisk_registry::Registry;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/split_decision")
}

fn catalog() -> RuleCatalog {
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    let operators: Vec<Operator> = Registry::load_dir(&plugins)
        .unwrap()
        .operators()
        .cloned()
        .collect();
    RuleCatalog::load_dir(&fixture().join("methodology"), &operators).unwrap()
}

const WALK: &str = "wlk_01JABCDEFGHJKMNPQRSTVWXYZ0";
const DECIDED: &str = "plv_01JABCDEFGHJKMNPQRSTVWXYZ2";
const MEASURED: &str = "plv_01JABCDEFGHJKMNPQRSTVWXYZ3";
const EDITED: &str = "plv_01JABCDEFGHJKMNPQRSTVWXYZ4";

fn step(round: u64, extra: Value) -> WalkStep {
    let mut doc = json!({ "schema_version": "sprisk.walk_step/v1", "walk_id": WALK,
                          "round": round, "reason": "Why.", "created_at": "2026-10-24T10:00:00Z" });
    doc.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    parse(&doc.to_string()).unwrap()
}

fn trail() -> Vec<WalkStep> {
    vec![
        step(
            0,
            json!({ "action": "decide", "pipeline_version_id": DECIDED,
            "decides": "data.repeated_items", "method": "methodology.core.repeated_items@1.0.0",
            "option": "group_by_title", "assurance": "confirmed",
            "reason": "A person answered: Treat rows with matching titles as one item.",
            "bindings": [{ "schema_version": "sprisk.binding/v1", "concept": "common.item_identity",
                "source": { "column": "item_group", "step": "near_duplicates" },
                "set_by": { "assurance": "confirmed", "method": "methodology.core.repeated_items@1.0.0" } }] }),
        ),
        step(
            1,
            json!({ "action": "decide", "pipeline_version_id": DECIDED,
            "made_pipeline_version_id": MEASURED,
            "decides": "evaluation.split_method", "method": "methodology.core.split_method@1.0.0",
            "option": "item_groups", "assurance": "rule", "promises": ["no_group_overlap"],
            "effects": [{ "kind": "replace_node", "node_id": "split",
                "operator": "sprisk.validation.group_split@1.0.0",
                "params": { "group_column": "item_group", "test_fraction": 0.2, "seed": 42 } }] }),
        ),
    ]
}

fn verify() -> WalkStep {
    step(
        2,
        json!({ "action": "verify", "pipeline_version_id": MEASURED,
        "verifications": [{ "decides": "evaluation.split_method",
            "method": "methodology.core.split_method@1.0.0", "verification": "no_group_overlap",
            "promise": "No item has rows in both train and test.", "step": "group_overlap",
            "result": "pass", "detail": "No item is in both sides." }] }),
    )
}

fn flow(id: &str, seed: i64) -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1", "id": id,
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0", "created_at": "2026-10-24T10:00:00Z",
            "nodes": [
                { "id": "load", "operator": "sprisk.io.file_source@1.0.0",
                  "params": { "path": "standin.csv", "format": "csv" } },
                { "id": "split", "operator": "sprisk.validation.group_split@1.0.0",
                  "params": { "group_column": "item_group", "test_fraction": 0.2, "seed": seed } },
                { "id": "group_overlap", "operator": "sprisk.validation.group_overlap@1.0.0",
                  "params": { "group_column": "item_group" } },
            ],
            "edges": [
                { "from": "load.data", "to": "split.data" },
                { "from": "split.train", "to": "group_overlap.train" },
                { "from": "split.test", "to": "group_overlap.test" },
            ],
        })
        .to_string(),
    )
    .unwrap()
}

fn decisions_json(
    steps: &[WalkStep],
    asked: &PipelineVersion,
    verified: Option<&PipelineVersion>,
) -> Value {
    let view = flow_decisions(&catalog(), &WALK.parse().unwrap(), steps, asked, verified).unwrap();
    serde_json::to_value(view).unwrap()
}

#[test]
fn each_decision_says_its_activity_its_option_and_the_steps_it_shaped() {
    let measured = flow(MEASURED, 42);
    let mut steps = trail();
    steps.push(verify());
    let view = decisions_json(&steps, &measured, Some(&measured));

    assert_eq!(view["walk_id"], WALK);
    let decisions = view["decisions"].as_array().unwrap();
    assert_eq!(decisions.len(), 2);
    assert_eq!(decisions[0]["name"], "Duplicate analysis");
    assert_eq!(decisions[0]["activity"], "Repeated observations");
    assert_eq!(
        decisions[0]["label"],
        "Treat rows with matching titles as one item"
    );
    assert_eq!(decisions[0]["steps"], json!(["near_duplicates"]));
    assert_eq!(decisions[1]["activity"], "Fair evaluation");
    assert_eq!(
        decisions[1]["question"],
        "How are rows divided into training and test so the score is fair?"
    );
    assert_eq!(decisions[1]["steps"], json!(["split", "group_overlap"]));
    assert_eq!(
        decisions[1]["promises"],
        json!([{ "verification": "no_group_overlap",
                 "promise": "No item has rows in both train and test.",
                 "status": "pass", "detail": "No item is in both sides.", "step": "group_overlap" }])
    );
}

#[test]
fn a_promise_on_an_edited_split_is_stale_and_says_what_it_found_last() {
    let mut steps = trail();
    steps.push(verify());
    let view = decisions_json(&steps, &flow(EDITED, 7), Some(&flow(MEASURED, 42)));

    let promise = &view["decisions"][1]["promises"][0];
    assert_eq!(promise["status"], "stale");
    assert_eq!(promise["last_result"], "pass");
    assert!(
        promise["detail"]
            .as_str()
            .unwrap()
            .contains("No item is in both sides."),
        "{promise}"
    );
}

#[test]
fn a_promise_not_checked_yet_is_not_evaluated() {
    let view = decisions_json(&trail(), &flow(MEASURED, 42), None);

    let promise = &view["decisions"][1]["promises"][0];
    assert_eq!(promise["status"], "not_evaluated");
    assert!(promise.get("step").is_none(), "{promise}");
}

#[test]
fn a_decision_by_a_method_no_pack_holds_is_an_error() {
    let mut steps = trail();
    steps[0].method = Some(parse("\"methodology.core.gone@1.0.0\"").unwrap());
    let measured = flow(MEASURED, 42);
    let found = flow_decisions(&catalog(), &WALK.parse().unwrap(), &steps, &measured, None);
    assert!(found.is_err());
}

#[test]
fn a_version_s_steps_run_until_the_walk_made_another() {
    let mut steps = trail();
    steps.push(verify());
    steps.push(step(
        3,
        json!({ "action": "apply", "pipeline_version_id": MEASURED,
        "made_pipeline_version_id": EDITED, "rule": "methodology.core.other@1.0.0" }),
    ));
    steps.push(step(
        4,
        json!({ "action": "verify", "pipeline_version_id": EDITED, "verifications": [] }),
    ));

    let rounds = |made_at| {
        while_head(&steps, made_at)
            .iter()
            .map(|s| s.round)
            .collect::<Vec<_>>()
    };
    // Made at round 1: its own verify at round 2 counts, the apply at round 3 starts another.
    assert_eq!(rounds(1), [0, 1, 2]);
    assert_eq!(rounds(3), [0, 1, 2, 3, 4]);
}

/// A promise failed and the split was decided again: only the decision in force is shown.
#[test]
fn a_decision_made_again_shows_only_the_one_in_force() {
    let measured = flow(MEASURED, 42);
    let mut steps = trail();
    steps.insert(
        1,
        step(
            1,
            json!({ "action": "decide", "pipeline_version_id": DECIDED,
            "decides": "evaluation.split_method", "method": "methodology.core.split_method@1.0.0",
            "option": "stratified_random", "assurance": "rule", "promises": ["no_row_in_both"] }),
        ),
    );
    steps[2].round = 2;
    let view = decisions_json(&steps, &measured, None);

    let options: Vec<&str> = view["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["option"].as_str().unwrap())
        .collect();
    assert_eq!(options, ["group_by_title", "item_groups"], "{view}");
}
