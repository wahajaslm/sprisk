//! What the walk checks after a run: each promise its decisions made, on the evidence the run
//! measured, and whether the test rows may be scored (ADR-0063 slice 5).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sprisk_contracts::{
    MethodVerified, Operator, PipelineVersion, PromiseCheck, PromiseResult, parse,
};
use sprisk_methodology::RuleCatalog;
use sprisk_methodology::deciding::Made;
use sprisk_methodology::verifying::{Measured, checked, checking, fresh, sealed_by};
use sprisk_registry::Registry;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/split_decision")
}

fn operators() -> Vec<Operator> {
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    Registry::load_dir(&plugins)
        .unwrap()
        .operators()
        .cloned()
        .collect()
}

fn catalog() -> RuleCatalog {
    RuleCatalog::load_dir(&fixture().join("methodology"), &operators()).unwrap()
}

fn split(option: &str) -> Made {
    Made {
        decides: "evaluation.split_method".into(),
        option: option.into(),
        bindings: Vec::new(),
        round: 0,
        ruled_out: Vec::new(),
    }
}

fn overlap(overlapping: i64) -> Measured {
    BTreeMap::from([(
        "evaluation.group_overlap".to_owned(),
        (
            "group_overlap".to_owned(),
            json!({ "overlapping": overlapping, "overlapping_groups": [],
                    "train_groups": 40, "test_groups": 10 }),
        ),
    )])
}

fn check(result: &str, detail: &str) -> PromiseCheck {
    parse(
        &json!({ "decides": "evaluation.split_method",
                 "method": "methodology.core.split_method@1.0.0",
                 "verification": "no_group_overlap",
                 "promise": "No item has rows in both train and test.",
                 "result": result, "detail": detail })
        .to_string(),
    )
    .unwrap()
}

#[test]
fn a_measured_promise_is_sent_with_its_evidence_and_settings() {
    let catalog = catalog();
    let found = checking(&catalog, &[split("item_groups")], &overlap(0)).unwrap();

    assert_eq!(found.len(), 1);
    assert_eq!(
        found[0].promise.promise,
        "No item has rows in both train and test."
    );
    let (step, request) = found[0].request.as_ref().unwrap();
    assert_eq!(step, "group_overlap");
    let request = serde_json::to_value(request).unwrap();
    assert_eq!(request["verification"], "no_group_overlap");
    assert_eq!(request["method"], "methodology.core.split_method@1.0.0");
    assert_eq!(
        request["evidence"],
        overlap(0)["evaluation.group_overlap"].1
    );
    assert_eq!(request["settings"], json!({}));
    assert!(
        request["module"]
            .as_str()
            .unwrap()
            .ends_with("split_method/method.py")
    );
}

#[test]
fn a_promise_s_settings_come_from_its_method() {
    let copy = tempfile::tempdir().unwrap();
    for entry in walkdir::WalkDir::new(fixture()) {
        let entry = entry.unwrap();
        let to = copy
            .path()
            .join(entry.path().strip_prefix(fixture()).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&to).unwrap();
        } else {
            std::fs::copy(entry.path(), &to).unwrap();
        }
    }
    let manifest = copy
        .path()
        .join("methodology/core/methods/split_method/method.yaml");
    let text = std::fs::read_to_string(&manifest).unwrap().replacen(
        "    needs: evaluation.row_overlap\n",
        "    needs: evaluation.row_overlap\n    settings: { at_most: 0 }\n",
        1,
    );
    std::fs::write(&manifest, text).unwrap();
    let catalog = RuleCatalog::load_dir(&copy.path().join("methodology"), &operators()).unwrap();
    let measured = BTreeMap::from([(
        "evaluation.row_overlap".to_owned(),
        (
            "row_overlap".to_owned(),
            json!({ "in_both": 0, "train_rows": 80, "test_rows": 20 }),
        ),
    )]);
    let found = checking(&catalog, &[split("stratified_random")], &measured).unwrap();
    let request = serde_json::to_value(&found[0].request.as_ref().unwrap().1).unwrap();
    assert_eq!(request["settings"], json!({ "at_most": 0 }));
}

#[test]
fn a_promise_nothing_measured_is_not_evaluated_and_says_which_evidence_is_missing() {
    let catalog = catalog();
    let found = checking(&catalog, &[split("item_groups")], &Measured::new()).unwrap();

    assert!(found[0].request.is_none());
    let recorded = found[0].not_evaluated().unwrap();
    assert_eq!(recorded.result, PromiseResult::NotEvaluated);
    assert!(recorded.step.is_none());
    assert!(
        recorded.detail.contains("evaluation.group_overlap"),
        "{:?}",
        recorded.detail
    );
}

#[test]
fn a_random_split_promises_no_row_in_both_and_never_reads_the_test_labels() {
    let catalog = catalog();
    for option in ["simple_random", "stratified_random"] {
        let found = checking(&catalog, &[split(option)], &Measured::new()).unwrap();
        let names: Vec<&str> = found.iter().map(|c| c.promise.name.as_str()).collect();
        assert_eq!(names, ["no_row_in_both"], "{option}");
    }
}

#[test]
fn a_verified_promise_records_its_result_and_the_step_that_measured_it() {
    let catalog = catalog();
    let found = checking(&catalog, &[split("item_groups")], &overlap(0)).unwrap();
    let verified: MethodVerified = parse(
        &json!({ "answer": "verified", "method": "methodology.core.split_method@1.0.0",
                 "verification": "no_group_overlap", "result": "pass",
                 "detail": "No item is in both sides." })
        .to_string(),
    )
    .unwrap();

    let recorded = checked(&found[0], &verified).unwrap();
    let mut expected = check("pass", "No item is in both sides.");
    expected.step = Some(parse("\"group_overlap\"").unwrap());
    assert_eq!(recorded, expected);
}

#[test]
fn the_test_rows_stay_sealed_unless_every_promise_passed() {
    assert_eq!(sealed_by(Some(&[check("pass", "Fine.")])), None);
    let held = sealed_by(Some(&[
        check("pass", "Fine."),
        check("fail", "3 items have rows in both train and test."),
    ]))
    .unwrap();
    assert!(held.contains("evaluation.split_method"), "{held}");
    assert!(held.contains("no_group_overlap"), "{held}");
    assert!(held.contains("3 items have rows in both"), "{held}");
    assert!(sealed_by(Some(&[check("inconclusive", "One side has no groups.")])).is_some());
    assert!(sealed_by(Some(&[check("not_evaluated", "Nothing measured it.")])).is_some());
}

#[test]
fn promises_never_checked_on_the_flow_keep_the_test_rows_sealed() {
    let held = sealed_by(None).unwrap();
    assert!(held.contains("not checked on this flow"), "{held}");
}

fn flow(id: &str, nodes: Value, edges: Value) -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1", "id": id,
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": nodes, "edges": edges, "created_at": "2026-10-23T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

const VERIFIED: &str = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0";
const LATER: &str = "plv_01JABCDEFGHJKMNPQRSTVWXYZ1";

/// Load, a group split, the producer on its outputs, and a model after it.
fn verified_parts() -> (Vec<Value>, Vec<Value>) {
    (
        vec![
            json!({ "id": "load", "operator": "sprisk.io.file_source@1.0.0",
                    "params": { "path": "standin.csv", "format": "csv" } }),
            json!({ "id": "split", "operator": "sprisk.validation.group_split@1.0.0",
                    "params": { "group_column": "item_group", "test_fraction": 0.2, "seed": 42 } }),
            json!({ "id": "group_overlap", "operator": "sprisk.validation.group_overlap@1.0.0",
                    "params": { "group_column": "item_group" } }),
            json!({ "id": "model", "operator": "sprisk.ml.baseline@1.0.0", "params": {} }),
        ],
        vec![
            json!({ "from": "load.data", "to": "split.data" }),
            json!({ "from": "split.train", "to": "group_overlap.train" }),
            json!({ "from": "split.test", "to": "group_overlap.test" }),
            json!({ "from": "split.train", "to": "model.train" }),
        ],
    )
}

fn measured_check() -> PromiseCheck {
    let mut c = check("pass", "No item is in both sides.");
    c.step = Some(parse("\"group_overlap\"").unwrap());
    c
}

fn later(change: impl FnOnce(&mut Vec<Value>, &mut Vec<Value>)) -> bool {
    let (nodes, edges) = verified_parts();
    let verified = flow(VERIFIED, json!(nodes), json!(edges));
    let (mut nodes, mut edges) = verified_parts();
    change(&mut nodes, &mut edges);
    fresh(
        &verified,
        &flow(LATER, json!(nodes), json!(edges)),
        &measured_check(),
    )
}

#[test]
fn a_check_stays_fresh_while_nothing_before_its_evidence_changes() {
    assert!(later(|_, _| {}));
    // A model changed after the split changes nothing the promise read.
    assert!(later(
        |nodes, _| nodes[3]["params"] = json!({ "strategy": "prior" })
    ));
}

#[test]
fn a_check_goes_stale_when_the_split_s_settings_change() {
    assert!(!later(|nodes, _| nodes[1]["params"]["seed"] = json!(7)));
}

#[test]
fn a_check_goes_stale_when_the_split_becomes_custom_code() {
    assert!(!later(|nodes, _| {
        nodes[1] = json!({ "id": "split", "operator": "sprisk.code.python@1.0.0",
                           "params": { "source": "train, test = data[:80], data[80:]" } });
    }));
}

#[test]
fn a_check_goes_stale_when_a_step_is_added_before_the_split() {
    assert!(!later(|nodes, edges| {
        nodes.push(json!({ "id": "dedupe", "operator": "sprisk.clean.drop_duplicates@1.0.0", "params": {} }));
        edges[0] = json!({ "from": "load.data", "to": "dedupe.data" });
        edges.push(json!({ "from": "dedupe.data", "to": "split.data" }));
    }));
}

#[test]
fn a_check_goes_stale_when_its_producer_is_gone() {
    assert!(!later(|nodes, edges| {
        nodes.remove(2);
        edges.retain(|e| !e["to"].as_str().unwrap().starts_with("group_overlap"));
    }));
}

#[test]
fn a_promise_nothing_measured_is_fresh_only_on_the_version_it_was_checked_on() {
    let (nodes, edges) = verified_parts();
    let verified = flow(VERIFIED, json!(nodes.clone()), json!(edges.clone()));
    let unmeasured = check("not_evaluated", "No step measured it.");
    assert!(fresh(&verified, &verified, &unmeasured));
    assert!(!fresh(
        &verified,
        &flow(LATER, json!(nodes), json!(edges)),
        &unmeasured
    ));
}
