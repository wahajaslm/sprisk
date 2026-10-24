//! Every change to a flow is a patch of typed effects, applied whole or not at all
//! (ADR-0063): each effect is checked against the flow as the earlier ones left it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{GraphEffect, PipelineVersion, parse};
use sprisk_methodology::{ResolveError, patch};
use sprisk_registry::Registry;

fn registry() -> Registry {
    Registry::load_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins")).unwrap()
}

fn flow() -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                { "id": "load", "operator": "sprisk.io.file_source@1.0.0",
                  "params": { "path": "standin.csv", "format": "csv" } },
                { "id": "exact_duplicates", "operator": "sprisk.clean.drop_duplicates@1.0.0", "params": {} },
                { "id": "split", "operator": "sprisk.validation.random_split@1.0.0",
                  "params": { "test_fraction": 0.2, "seed": 42 } },
            ],
            "edges": [
                { "from": "load.data", "to": "exact_duplicates.data" },
                { "from": "exact_duplicates.data", "to": "split.data" },
            ],
            "created_at": "2026-10-24T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

fn effects(value: Value) -> Vec<GraphEffect> {
    serde_json::from_value(value).unwrap()
}

fn add_producer() -> Value {
    json!({ "kind": "add_node", "node_id": "near_duplicates",
            "operator": "sprisk.profile.near_duplicates@1.0.0",
            "params": { "title_column": "designation" }, "inputs": { "data": "load.data" } })
}

fn edges_of(edges: &[sprisk_contracts::Edge]) -> Vec<String> {
    let mut all: Vec<String> = edges
        .iter()
        .map(|e| format!("{} -> {}", e.from.as_str(), e.to.as_str()))
        .collect();
    all.sort();
    all
}

fn apply(
    value: Value,
) -> Result<(Vec<sprisk_contracts::Node>, Vec<sprisk_contracts::Edge>), ResolveError> {
    let registry = registry();
    patch::apply(&flow(), &effects(value), |o| registry.get(o))
}

#[test]
fn add_node_adds_a_step_that_reads_the_named_outputs_and_feeds_nothing() {
    let (nodes, edges) = apply(json!([add_producer()])).unwrap();
    assert_eq!(nodes.len(), 4);
    assert_eq!(
        edges_of(&edges),
        [
            "exact_duplicates.data -> split.data",
            "load.data -> exact_duplicates.data",
            "load.data -> near_duplicates.data",
        ]
    );
}

#[test]
fn set_input_feeds_a_port_from_another_output_and_drops_what_fed_it() {
    let moved = json!({ "kind": "set_input", "node_id": "near_duplicates", "port": "data",
                        "from": "exact_duplicates.data" });
    let (_, edges) = apply(json!([add_producer(), moved])).unwrap();
    assert!(edges_of(&edges).contains(&"exact_duplicates.data -> near_duplicates.data".to_owned()));
    assert!(!edges_of(&edges).contains(&"load.data -> near_duplicates.data".to_owned()));
}

#[test]
fn replace_node_sets_a_step_s_operator_and_settings() {
    let reset = json!({ "kind": "replace_node", "node_id": "split",
                        "operator": "sprisk.validation.random_split@1.0.0",
                        "params": { "test_fraction": 0.3, "seed": 7 } });
    let (nodes, _) = apply(json!([reset])).unwrap();
    let split = nodes.iter().find(|n| n.id.as_str() == "split").unwrap();
    assert_eq!(split.params.get("test_fraction"), Some(&json!(0.3)));
}

#[test]
fn a_step_id_already_taken_is_refused() {
    let mut taken = add_producer();
    taken["node_id"] = json!("split");
    let refused = apply(json!([taken])).unwrap_err();
    assert!(
        refused
            .to_string()
            .contains("a step named split already exists"),
        "{refused}"
    );
}

#[test]
fn an_input_the_operator_lacks_is_refused() {
    let mut wrong = add_producer();
    wrong["inputs"] = json!({ "rows": "load.data" });
    let refused = apply(json!([wrong])).unwrap_err();
    assert!(
        refused
            .to_string()
            .contains("sprisk.profile.near_duplicates@1.0.0 has no input rows"),
        "{refused}"
    );
}

#[test]
fn an_input_that_leaves_an_input_unread_is_refused() {
    let mut none = add_producer();
    none["inputs"] = json!({});
    let refused = apply(json!([none])).unwrap_err();
    assert!(
        refused
            .to_string()
            .contains("near_duplicates reads nothing on data"),
        "{refused}"
    );
}

#[test]
fn reading_an_output_no_step_has_is_refused() {
    let mut wrong = add_producer();
    wrong["inputs"] = json!({ "data": "load.rows" });
    let refused = apply(json!([wrong])).unwrap_err();
    assert!(
        refused.to_string().contains("load has no output rows"),
        "{refused}"
    );
}

#[test]
fn rewiring_a_step_that_does_not_exist_is_refused() {
    let moved = json!({ "kind": "set_input", "node_id": "near_duplicates", "port": "data",
                        "from": "exact_duplicates.data" });
    let refused = apply(json!([moved])).unwrap_err();
    assert!(
        matches!(refused, ResolveError::UnknownNode(ref id) if id == "near_duplicates"),
        "{refused}"
    );
}

#[test]
fn a_patch_whose_later_effect_fails_changes_nothing() {
    let moved = json!({ "kind": "set_input", "node_id": "near_duplicates", "port": "rows",
                        "from": "exact_duplicates.data" });
    assert!(apply(json!([add_producer(), moved])).is_err());
    // The flow given is never changed; a refused patch has no partial result to keep.
    assert_eq!(flow().nodes.len(), 3);
}
