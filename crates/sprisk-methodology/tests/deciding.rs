//! What methods decide in a walk (ADR-0063 slice 4): which method is ready, what it reads,
//! and the bindings and patch its option makes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sprisk_contracts::{MethodAssurance, Operator, PipelineVersion, QuestionVersion, parse};
use sprisk_methodology::deciding::{Made, apply_option, bindings, ready};
use sprisk_methodology::{RuleCatalog, patch};
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

fn catalog(operators: &[Operator]) -> RuleCatalog {
    RuleCatalog::load_dir(&fixture().join("methodology"), operators).unwrap()
}

const REPEATED: &str = "data.repeated_items";
const SPLIT: &str = "evaluation.split_method";
const KIND: &str = "data.near_duplicate_groups";

fn stated(concept: &str, column: &str) -> Value {
    json!({ "schema_version": "sprisk.binding/v1", "concept": concept,
            "source": { "column": column }, "set_by": { "assurance": "stated" } })
}

fn question(extra: Value) -> QuestionVersion {
    let mut q = json!({
        "schema_version": "sprisk.question_version/v1",
        "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "objective": { "value": "Tell each listing's product type.", "origin": "explicit" },
        "task": { "value": "classification", "origin": "explicit" },
        "target": { "value": "prdtypecode", "origin": "explicit" },
        "assumptions": [], "unknowns": [], "acceptance_criteria": [],
        "created_at": "2026-10-24T10:00:00Z",
    });
    q.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    parse(&q.to_string()).unwrap()
}

fn titled() -> QuestionVersion {
    question(json!({ "bindings": [stated("common.item_title", "designation")] }))
}

/// Load, the near-duplicates producer on the rows the split reads, and the split.
fn measured_flow() -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                { "id": "load", "operator": "sprisk.io.file_source@1.0.0",
                  "params": { "path": "standin.csv", "format": "csv" } },
                { "id": "near_duplicates", "operator": "sprisk.profile.near_duplicates@1.0.0",
                  "params": { "title_column": "designation" } },
                { "id": "split", "operator": "sprisk.validation.random_split@1.0.0",
                  "params": { "test_fraction": 0.2, "seed": 42 } },
            ],
            "edges": [
                { "from": "load.data", "to": "near_duplicates.data" },
                { "from": "load.data", "to": "split.data" },
            ],
            "created_at": "2026-10-24T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

fn groups(groups: i64) -> BTreeMap<String, Value> {
    BTreeMap::from([(
        KIND.to_owned(),
        json!({ "rows": 596, "groups": groups, "rows_in_groups": 201, "largest_group": 4 }),
    )])
}

fn made(decides: &str, option: &str, bindings: Value) -> Made {
    Made {
        decides: decides.to_owned(),
        option: option.to_owned(),
        bindings: serde_json::from_value(bindings).unwrap(),
    }
}

fn ready_ids(
    catalog: &RuleCatalog,
    q: &QuestionVersion,
    done: &[Made],
    measured: &BTreeMap<String, Value>,
    ops: &[Operator],
) -> Vec<String> {
    let effective = bindings(q, done).unwrap();
    ready(catalog, q, done, &effective, measured, ops)
        .unwrap()
        .ready
        .iter()
        .map(|r| r.method.decides.to_string())
        .collect()
}

#[test]
fn a_stated_or_confirmed_question_fact_counts_as_its_concept_s_binding() {
    let q = question(json!({
        "entity_column": { "value": "listing_id", "origin": "confirmed" },
        "time_column": { "value": "listed_on", "origin": "inferred" },
    }));
    let effective = bindings(&q, &[]).unwrap();
    let bound: BTreeMap<String, String> = effective
        .bindings
        .iter()
        .map(|b| (b.concept.to_string(), b.source.column.to_string()))
        .collect();
    assert_eq!(
        bound,
        BTreeMap::from([
            ("common.item_identity".to_owned(), "listing_id".to_owned()),
            ("common.target".to_owned(), "prdtypecode".to_owned()),
        ])
    );
    // A guess is not a binding: it is asked first.
    assert_eq!(
        effective.guesses,
        BTreeMap::from([("common.event_time".to_owned(), "time_column".to_owned())])
    );
}

#[test]
fn a_binding_on_the_question_wins_over_the_fact_and_a_decision_adds_its_own() {
    let q = question(json!({
        "entity_column": { "value": "listing_id", "origin": "explicit" },
        "bindings": [stated("common.item_identity", "seller_item")],
    }));
    let derived = json!([{ "schema_version": "sprisk.binding/v1", "concept": "common.item_title",
        "source": { "column": "item_group", "step": "near_duplicates" },
        "set_by": { "assurance": "rule", "method": "methodology.core.repeated_items@1.0.0" } }]);
    let effective = bindings(&q, &[made(REPEATED, "group_by_title", derived)]).unwrap();
    let columns: Vec<String> = effective
        .bindings
        .iter()
        .map(|b| format!("{} {}", b.concept.as_str(), b.source.column.as_str()))
        .collect();
    assert_eq!(
        columns,
        [
            "common.item_identity seller_item",
            "common.target prdtypecode",
            "common.item_title item_group"
        ]
    );
}

#[test]
fn a_method_waits_until_its_evidence_is_measured() {
    let ops = operators();
    let catalog = catalog(&ops);
    let waiting = ready_ids(&catalog, &titled(), &[], &BTreeMap::new(), &ops);
    assert!(waiting.is_empty(), "{waiting:?}");
    assert_eq!(
        ready_ids(&catalog, &titled(), &[], &groups(83), &ops),
        [REPEATED]
    );
}

#[test]
fn evidence_that_cannot_be_measured_is_left_out_and_the_method_decides_without_it() {
    let ops = operators();
    let catalog = catalog(&ops);
    let q = question(json!({}));
    let effective = bindings(&q, &[]).unwrap();
    let found = ready(&catalog, &q, &[], &effective, &BTreeMap::new(), &ops).unwrap();
    let request = serde_json::to_value(&found.ready[0].request).unwrap();
    assert_eq!(request["method"], "methodology.core.repeated_items@1.0.0");
    assert_eq!(request["evidence"], json!({}));
    assert_eq!(request["bound"], json!([]));
}

#[test]
fn a_request_carries_only_what_the_method_declares() {
    let ops = operators();
    let catalog = catalog(&ops);
    let q = titled();
    let effective = bindings(&q, &[]).unwrap();
    let found = ready(&catalog, &q, &[], &effective, &groups(83), &ops).unwrap();
    let request = serde_json::to_value(&found.ready[0].request).unwrap();
    assert_eq!(request["evidence"], json!({ KIND: groups(83)[KIND] }));
    assert_eq!(request["bound"], json!(["common.item_title"]));
    assert_eq!(
        request["options"],
        json!(["group_by_title", "independent_rows", "stated_items"])
    );
    assert_eq!(request["task"], "classification");
    assert!(
        request["module"]
            .as_str()
            .unwrap()
            .ends_with("repeated_items/method.py")
    );
    // No column name crosses to Python.
    assert!(!request.to_string().contains("designation"), "{request}");
}

#[test]
fn a_method_waits_for_the_decisions_it_reads_then_receives_them() {
    let ops = operators();
    let catalog = catalog(&ops);
    let done = [made(REPEATED, "independent_rows", json!([]))];
    assert_eq!(
        ready_ids(&catalog, &titled(), &done, &groups(0), &ops),
        [SPLIT]
    );
    let q = titled();
    let effective = bindings(&q, &done).unwrap();
    let found = ready(&catalog, &q, &done, &effective, &groups(0), &ops).unwrap();
    let request = serde_json::to_value(&found.ready[0].request).unwrap();
    assert_eq!(
        request["decisions"],
        json!({ REPEATED: "independent_rows" })
    );
    assert_eq!(request["bound"], json!(["common.target"]));
}

#[test]
fn a_guessed_fact_a_method_reads_is_asked_before_it_decides() {
    let ops = operators();
    let catalog = catalog(&ops);
    let q = question(json!({ "time_column": { "value": "listed_on", "origin": "inferred" } }));
    let done = [made(REPEATED, "independent_rows", json!([]))];
    let effective = bindings(&q, &done).unwrap();
    let found = ready(&catalog, &q, &done, &effective, &BTreeMap::new(), &ops).unwrap();
    assert!(found.ready.is_empty());
    let asks = serde_json::to_value(&found.asks).unwrap();
    assert_eq!(asks[0]["decides"], "question.time_column");
    assert!(
        asks[0]["question"].as_str().unwrap().contains("guess"),
        "{asks}"
    );
}

#[test]
fn a_bind_option_binds_its_concept_to_the_column_the_producer_adds() {
    let ops = operators();
    let catalog = catalog(&ops);
    let method = catalog
        .methods()
        .find(|m| m.decides.as_str() == REPEATED)
        .unwrap();
    let q = titled();
    let effective = bindings(&q, &[]).unwrap();
    let applied = apply_option(
        method,
        "group_by_title",
        MethodAssurance::Confirmed,
        &effective.bindings,
        &measured_flow(),
        &ops,
        &BTreeMap::new(),
    )
    .unwrap();
    assert!(applied.effects.is_empty());
    assert_eq!(
        serde_json::to_value(&applied.bindings).unwrap(),
        json!([{ "schema_version": "sprisk.binding/v1", "concept": "common.item_identity",
                 "source": { "column": "item_group", "step": "near_duplicates" },
                 "set_by": { "assurance": "confirmed",
                             "method": "methodology.core.repeated_items@1.0.0" } }])
    );
}

#[test]
fn a_group_split_reads_the_step_that_adds_its_group_column() {
    let ops = operators();
    let catalog = catalog(&ops);
    let method = catalog
        .methods()
        .find(|m| m.decides.as_str() == SPLIT)
        .unwrap();
    let derived = json!([{ "schema_version": "sprisk.binding/v1",
        "concept": "common.item_identity",
        "source": { "column": "item_group", "step": "near_duplicates" },
        "set_by": { "assurance": "confirmed", "method": "methodology.core.repeated_items@1.0.0" } }]);
    let q = titled();
    let effective = bindings(&q, &[made(REPEATED, "group_by_title", derived)]).unwrap();
    let flow = measured_flow();
    let applied = apply_option(
        method,
        "item_groups",
        MethodAssurance::Rule,
        &effective.bindings,
        &flow,
        &ops,
        &BTreeMap::new(),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&applied.effects).unwrap(),
        json!([
            { "kind": "replace_node", "node_id": "split",
              "operator": "sprisk.validation.group_split@1.0.0",
              "params": { "group_column": "item_group", "test_fraction": 0.2, "seed": 42 } },
            { "kind": "set_input", "node_id": "split", "port": "data",
              "from": "near_duplicates.data" },
        ])
    );
    assert_eq!(applied.promises, ["no_group_overlap"]);
    assert!(applied.bindings.is_empty());
    let (_, edges) = patch::apply(&flow, &applied.effects, |id| {
        ops.iter().find(|o| o.id.as_str() == id)
    })
    .unwrap();
    assert!(
        edges
            .iter()
            .any(|e| e.from.as_str() == "near_duplicates.data" && e.to.as_str() == "split.data")
    );
}

#[test]
fn a_stratified_split_reads_the_target_from_its_binding() {
    let ops = operators();
    let catalog = catalog(&ops);
    let method = catalog
        .methods()
        .find(|m| m.decides.as_str() == SPLIT)
        .unwrap();
    let q = titled();
    let effective = bindings(&q, &[]).unwrap();
    let applied = apply_option(
        method,
        "stratified_random",
        MethodAssurance::Rule,
        &effective.bindings,
        &measured_flow(),
        &ops,
        &BTreeMap::new(),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&applied.effects).unwrap(),
        json!([{ "kind": "replace_node", "node_id": "split",
                 "operator": "sprisk.validation.random_split@1.0.0",
                 "params": { "stratify": "prdtypecode", "test_fraction": 0.2, "seed": 42 } }])
    );
    assert_eq!(applied.promises, ["class_shares_kept"]);
}

#[test]
fn an_option_the_method_does_not_have_is_refused() {
    let ops = operators();
    let catalog = catalog(&ops);
    let method = catalog
        .methods()
        .find(|m| m.decides.as_str() == SPLIT)
        .unwrap();
    let refused = apply_option(
        method,
        "shuffled",
        MethodAssurance::Confirmed,
        &[],
        &measured_flow(),
        &ops,
        &BTreeMap::new(),
    )
    .unwrap_err();
    assert!(refused.to_string().contains("shuffled"), "{refused}");
}

#[test]
fn an_insert_option_adds_its_step_before_the_split_with_settings_from_evidence() {
    let ops = operators();
    let catalog = RuleCatalog::load_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/text_spelling/methodology"),
        &ops,
    )
    .unwrap();
    let method = catalog.methods().next().unwrap();
    let q = question(json!({}));
    let effective = bindings(&q, &[]).unwrap();
    let measured = BTreeMap::from([(
        "data.spelling_variants".to_owned(),
        json!({ "columns": ["city", "colour"], "identifier_like": [], "accent_only": [], "text_columns": 3 }),
    )]);
    let flow = measured_flow();
    let applied = apply_option(
        method,
        "normalise",
        MethodAssurance::Rule,
        &effective.bindings,
        &flow,
        &ops,
        &measured,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&applied.effects).unwrap(),
        json!([{ "kind": "insert_node", "node_id": "text_spelling", "before": "split",
                 "operator": "sprisk.clean.clean_text@1.0.0",
                 "params": { "lowercase": true, "empty_to_null": false,
                             "columns": ["city", "colour"], "exclude": ["prdtypecode"] } }])
    );
    let (nodes, edges) = patch::apply(&flow, &applied.effects, |id| {
        ops.iter().find(|o| o.id.as_str() == id)
    })
    .unwrap();
    assert!(nodes.iter().any(|n| n.id.as_str() == "text_spelling"));
    assert!(
        edges
            .iter()
            .any(|e| e.from.as_str() == "text_spelling.data" && e.to.as_str() == "split.data")
    );
}

#[test]
fn an_insert_whose_evidence_was_not_measured_is_refused() {
    let ops = operators();
    let catalog = RuleCatalog::load_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/text_spelling/methodology"),
        &ops,
    )
    .unwrap();
    let method = catalog.methods().next().unwrap();
    let effective = bindings(&question(json!({})), &[]).unwrap();
    let refused = apply_option(
        method,
        "normalise",
        MethodAssurance::Rule,
        &effective.bindings,
        &measured_flow(),
        &ops,
        &BTreeMap::new(),
    )
    .unwrap_err();
    assert!(
        refused.to_string().contains("data.spelling_variants"),
        "{refused}"
    );
}
