//! The engine adds the producers of the evidence methods need, placed by their `attach`,
//! and keeps them on the rows they measure as steps are added (ADR-0063 slice 3).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sprisk_contracts::{Operator, PipelineVersion, QuestionVersion, parse};
use sprisk_methodology::measure::{Measuring, measure};
use sprisk_methodology::{RuleCatalog, patch};
use sprisk_registry::Registry;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/split_decision")
}

/// The registered plugins, the near-duplicates producer among them, and the fixture's
/// manifest-only producers.
fn operators() -> Vec<Operator> {
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    let plugins = Registry::load_dir(&plugins).unwrap();
    let producers = Registry::load_dir(&fixture().join("operators")).unwrap();
    plugins
        .operators()
        .chain(producers.operators())
        .cloned()
        .collect()
}

fn catalog(operators: &[Operator]) -> RuleCatalog {
    RuleCatalog::load_dir(&fixture().join("methodology"), operators).unwrap()
}

fn question(bindings: Value) -> QuestionVersion {
    parse(
        &json!({
            "schema_version": "sprisk.question_version/v1",
            "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "objective": { "value": "Tell each listing's product type.", "origin": "explicit" },
            "task": { "value": "classification", "origin": "explicit" },
            "target": { "value": "prdtypecode", "origin": "explicit" },
            "assumptions": [], "unknowns": [], "acceptance_criteria": [],
            "bindings": bindings,
            "created_at": "2026-10-23T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

fn titled() -> QuestionVersion {
    question(
        json!([{ "schema_version": "sprisk.binding/v1", "concept": "common.item_title",
        "source": { "column": "designation" }, "set_by": { "assurance": "stated" } }]),
    )
}

fn flow(nodes: Value, edges: Value) -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": nodes, "edges": edges, "created_at": "2026-10-23T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

const LOAD: &str = "sprisk.io.file_source@1.0.0";
const SPLIT: &str = "sprisk.validation.random_split@1.0.0";
const DROP_DUPLICATES: &str = "sprisk.clean.drop_duplicates@1.0.0";
const PRODUCER: &str = "sprisk.profile.near_duplicates@1.0.0";

fn load_split() -> (Value, Value) {
    (
        json!([
            { "id": "load", "operator": LOAD, "params": { "path": "standin.csv", "format": "csv" } },
            { "id": "split", "operator": SPLIT, "params": { "test_fraction": 0.2, "seed": 42 } },
        ]),
        json!([{ "from": "load.data", "to": "split.data" }]),
    )
}

/// `pipeline` with the patch `measured` returns applied, as the walk applies it.
fn applied(pipeline: &PipelineVersion, measured: &Measuring, ops: &[Operator]) -> PipelineVersion {
    let (nodes, edges) = patch::apply(pipeline, &measured.effects, |id| {
        ops.iter().find(|o| o.id.as_str() == id)
    })
    .unwrap();
    flow(json!(nodes), json!(edges))
}

fn effects_of(measured: &Measuring) -> Value {
    serde_json::to_value(&measured.effects).unwrap()
}

fn edges_of(pipeline: &[sprisk_contracts::Edge]) -> Vec<String> {
    let mut all: Vec<String> = pipeline
        .iter()
        .map(|e| format!("{} -> {}", e.from.as_str(), e.to.as_str()))
        .collect();
    all.sort();
    all
}

#[test]
fn a_needed_producer_is_added_on_the_rows_the_split_reads() {
    let ops = operators();
    let (nodes, edges) = load_split();
    let start = flow(nodes, edges);
    let measured = measure(&catalog(&ops), &start, &titled(), &titled().bindings, &ops).unwrap();

    assert_eq!(
        effects_of(&measured),
        json!([{ "kind": "add_node", "node_id": "near_duplicates", "operator": PRODUCER,
                 "params": { "title_column": "designation" }, "inputs": { "data": "load.data" } }])
    );
    let result = applied(&start, &measured, &ops);
    let added = result
        .nodes
        .iter()
        .find(|n| n.operator.as_str() == PRODUCER)
        .unwrap();
    assert_eq!(added.id.as_str(), "near_duplicates");
    assert_eq!(
        added.params.get("title_column"),
        Some(&json!("designation"))
    );
    assert_eq!(
        edges_of(&result.edges),
        [
            "load.data -> near_duplicates.data",
            "load.data -> split.data"
        ]
    );
    assert_eq!(
        measured.changes,
        [
            "Adds near_duplicates on the rows split reads: data.repeated_items needs data.near_duplicate_groups."
        ]
    );
}

#[test]
fn a_producer_in_place_changes_nothing() {
    let ops = operators();
    let (nodes, edges) = load_split();
    let start = flow(nodes, edges);
    let first = measure(&catalog(&ops), &start, &titled(), &titled().bindings, &ops).unwrap();
    let placed = applied(&start, &first, &ops);

    let again = measure(&catalog(&ops), &placed, &titled(), &titled().bindings, &ops).unwrap();
    assert!(again.effects.is_empty(), "{:?}", again.effects);
    assert!(again.changes.is_empty(), "{:?}", again.changes);
}

#[test]
fn a_producer_follows_a_step_added_before_the_split() {
    let ops = operators();
    let nodes = json!([
        { "id": "load", "operator": LOAD, "params": { "path": "standin.csv", "format": "csv" } },
        { "id": "exact_duplicates", "operator": DROP_DUPLICATES, "params": {} },
        { "id": "split", "operator": SPLIT, "params": { "test_fraction": 0.2, "seed": 42 } },
        { "id": "near_duplicates", "operator": PRODUCER, "params": { "title_column": "designation" } },
    ]);
    let edges = json!([
        { "from": "load.data", "to": "exact_duplicates.data" },
        { "from": "exact_duplicates.data", "to": "split.data" },
        { "from": "load.data", "to": "near_duplicates.data" },
    ]);
    let start = flow(nodes, edges);
    let measured = measure(&catalog(&ops), &start, &titled(), &titled().bindings, &ops).unwrap();

    assert_eq!(
        effects_of(&measured),
        json!([{ "kind": "set_input", "node_id": "near_duplicates", "port": "data",
                 "from": "exact_duplicates.data" }])
    );
    let result = applied(&start, &measured, &ops);
    assert!(
        edges_of(&result.edges)
            .contains(&"exact_duplicates.data -> near_duplicates.data".to_owned())
    );
    assert!(!edges_of(&result.edges).contains(&"load.data -> near_duplicates.data".to_owned()));
    assert_eq!(
        measured.changes,
        ["Moves near_duplicates onto the rows split reads now."]
    );
}

#[test]
fn a_producer_whose_concept_is_unbound_is_not_added_and_says_what_to_state() {
    let ops = operators();
    let (nodes, edges) = load_split();
    let measured = measure(
        &catalog(&ops),
        &flow(nodes, edges),
        &question(json!([])),
        &[],
        &ops,
    )
    .unwrap();

    assert!(measured.changes.is_empty());
    assert!(measured.effects.is_empty());
    assert_eq!(
        measured.left_out,
        [
            "data.repeated_items needs common.item_title (Short text that names the item a row describes.): state which column holds it, if one does."
        ]
    );
}

#[test]
fn a_producer_with_no_step_of_its_attach_role_is_left_out_with_a_note() {
    let ops = operators();
    let nodes = json!([{ "id": "load", "operator": LOAD, "params": { "path": "standin.csv", "format": "csv" } }]);
    let measured = measure(
        &catalog(&ops),
        &flow(nodes, json!([])),
        &titled(),
        &titled().bindings,
        &ops,
    )
    .unwrap();

    assert!(measured.changes.is_empty());
    assert!(measured.effects.is_empty());
    assert_eq!(
        measured.left_out,
        ["data.repeated_items needs data.near_duplicate_groups, but no step has the role split."]
    );
}

#[test]
fn a_producer_with_two_steps_of_its_attach_role_is_left_out_with_a_note() {
    let ops = operators();
    let nodes = json!([
        { "id": "load", "operator": LOAD, "params": { "path": "standin.csv", "format": "csv" } },
        { "id": "split", "operator": SPLIT, "params": { "test_fraction": 0.2, "seed": 42 } },
        { "id": "split_2", "operator": SPLIT, "params": { "test_fraction": 0.2, "seed": 42 } },
    ]);
    let edges = json!([
        { "from": "load.data", "to": "split.data" },
        { "from": "load.data", "to": "split_2.data" },
    ]);
    let measured = measure(
        &catalog(&ops),
        &flow(nodes, edges),
        &titled(),
        &titled().bindings,
        &ops,
    )
    .unwrap();

    assert!(measured.changes.is_empty());
    assert_eq!(
        measured.left_out,
        [
            "data.repeated_items needs data.near_duplicate_groups, but several steps have the role split."
        ]
    );
}

#[test]
fn a_rebound_concept_resets_the_producer_s_column() {
    let ops = operators();
    let (nodes, edges) = load_split();
    let start = flow(nodes, edges);
    let first = measure(&catalog(&ops), &start, &titled(), &titled().bindings, &ops).unwrap();
    let placed = applied(&start, &first, &ops);
    let retitled = question(
        json!([{ "schema_version": "sprisk.binding/v1", "concept": "common.item_title",
        "source": { "column": "titre" }, "set_by": { "assurance": "stated" } }]),
    );

    let again = measure(&catalog(&ops), &placed, &retitled, &retitled.bindings, &ops).unwrap();
    assert_eq!(
        effects_of(&again),
        json!([{ "kind": "replace_node", "node_id": "near_duplicates", "operator": PRODUCER,
                 "params": { "title_column": "titre" } }])
    );
    let step = applied(&placed, &again, &ops)
        .nodes
        .into_iter()
        .find(|n| n.id.as_str() == "near_duplicates")
        .unwrap();
    assert_eq!(step.params.get("title_column"), Some(&json!("titre")));
    assert_eq!(
        again.changes,
        ["Sets near_duplicates's columns from the question's bindings."]
    );
}

#[test]
fn a_producer_the_split_reads_from_stays_where_it_is() {
    // Once the split reads the column the producer adds, the producer is the rows' last step
    // before the split: moving it onto what the split reads would make it read itself.
    let ops = operators();
    let nodes = json!([
        { "id": "load", "operator": LOAD, "params": { "path": "standin.csv", "format": "csv" } },
        { "id": "near_duplicates", "operator": PRODUCER, "params": { "title_column": "designation" } },
        { "id": "split", "operator": "sprisk.validation.group_split@1.0.0",
          "params": { "group_column": "item_group", "test_fraction": 0.2, "seed": 42 } },
    ]);
    let edges = json!([
        { "from": "load.data", "to": "near_duplicates.data" },
        { "from": "near_duplicates.data", "to": "split.data" },
    ]);
    let q = titled();
    let measured = measure(&catalog(&ops), &flow(nodes, edges), &q, &q.bindings, &ops).unwrap();
    assert!(measured.effects.is_empty(), "{:?}", measured.effects);
}
