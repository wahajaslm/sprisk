//! What methods decide in a walk (ADR-0063 slice 4): which method is ready, what it reads,
//! and the bindings and patch its option makes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sprisk_contracts::{MethodAssurance, Operator, PipelineVersion, QuestionVersion, parse};
use sprisk_methodology::deciding::{
    Made, apply_option, bindings, made_by, ready, reopened_too_late,
};
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
        round: 0,
        ruled_out: Vec::new(),
    }
}

/// A walk step of `action` at `round`, with `extra` fields.
fn step(round: u32, action: &str, extra: Value) -> sprisk_contracts::WalkStep {
    let mut step = json!({
        "schema_version": "sprisk.walk_step/v1", "walk_id": "wlk_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "round": round, "action": action, "reason": "a step", "created_at": "2026-10-24T10:00:00Z",
    });
    step.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    parse(&step.to_string()).unwrap()
}

fn decided(round: u32, decides: &str, method: &str, option: &str) -> sprisk_contracts::WalkStep {
    let method = format!("methodology.core.{method}@1.0.0");
    step(
        round,
        "decide",
        json!({ "decides": decides, "method": method, "option": option }),
    )
}

/// A verify step where `decides`'s promise `verification` has `result`.
fn checked(
    round: u32,
    decides: &str,
    verification: &str,
    result: &str,
) -> sprisk_contracts::WalkStep {
    step(
        round,
        "verify",
        json!({ "verifications": [{
            "decides": decides, "method": "methodology.core.split_method@1.0.0",
            "verification": verification, "promise": "No test row has the same features as a train row.",
            "result": result, "detail": "12 test rows have the same features as a train row.",
        }] }),
    )
}

#[test]
fn a_failed_promise_rules_out_the_option_that_made_it_for_the_rest_of_the_walk() {
    let ops = operators();
    let catalog = catalog(&ops);
    let steps = [
        decided(1, REPEATED, "repeated_items", "independent_rows"),
        decided(2, SPLIT, "split_method", "stratified_random"),
        checked(3, SPLIT, "no_row_in_both", "fail"),
    ];
    let made = made_by(&catalog, &steps).unwrap();
    let split = made.iter().find(|m| m.decides == SPLIT).unwrap();
    let ruled: Vec<(&str, &str)> = split
        .ruled_out
        .iter()
        .map(|r| (r.option.as_str(), r.verification.as_str()))
        .collect();
    assert_eq!(
        ruled,
        [
            ("stratified_random", "no_row_in_both"),
            ("simple_random", "no_row_in_both")
        ]
    );

    // Decided again: the new option is in force, and the old one stays ruled out.
    let again = [
        steps.as_slice(),
        &[decided(4, SPLIT, "split_method", "simple_random")],
    ]
    .concat();
    let made = made_by(&catalog, &again).unwrap();
    let splits: Vec<&Made> = made.iter().filter(|m| m.decides == SPLIT).collect();
    assert_eq!(splits.len(), 1, "{made:?}");
    assert_eq!(splits[0].option, "simple_random");
    assert_eq!(splits[0].ruled_out.len(), 2);
}

#[test]
fn a_promise_that_passes_or_is_inconclusive_rules_nothing_out() {
    let ops = operators();
    let catalog = catalog(&ops);
    for result in ["pass", "inconclusive", "not_evaluated"] {
        let steps = [
            decided(1, SPLIT, "split_method", "stratified_random"),
            checked(2, SPLIT, "no_row_in_both", result),
        ];
        let made = made_by(&catalog, &steps).unwrap();
        assert!(made[0].ruled_out.is_empty(), "{result}");
    }
}

#[test]
fn a_decision_made_again_drops_the_decisions_that_read_it() {
    let ops = operators();
    let catalog = catalog(&ops);
    let steps = [
        decided(1, REPEATED, "repeated_items", "independent_rows"),
        decided(2, SPLIT, "split_method", "stratified_random"),
        decided(3, REPEATED, "repeated_items", "group_by_title"),
    ];
    let made = made_by(&catalog, &steps).unwrap();
    let keys: Vec<(&str, &str)> = made
        .iter()
        .map(|m| (m.decides.as_str(), m.option.as_str()))
        .collect();
    assert_eq!(keys, [(REPEATED, "group_by_title")]);
}

#[test]
fn a_ruled_out_decision_is_ready_again_without_its_ruled_out_option() {
    let ops = operators();
    let catalog = catalog(&ops);
    let steps = [
        decided(1, REPEATED, "repeated_items", "independent_rows"),
        decided(2, SPLIT, "split_method", "stratified_random"),
        checked(3, SPLIT, "no_row_in_both", "fail"),
    ];
    let done = made_by(&catalog, &steps).unwrap();
    let q = titled();
    let effective = bindings(&q, &done).unwrap();
    let found = ready(
        &catalog,
        &q,
        &done,
        &effective,
        &groups(0),
        &ops,
        &measured_flow(),
    )
    .unwrap();
    let request = serde_json::to_value(&found.ready[0].request).unwrap();
    assert_eq!(request["method"], "methodology.core.split_method@1.0.0");
    // The other random split makes the same promise, so it is ruled out with it.
    assert_eq!(request["options"], json!(["temporal", "item_groups"]));
    assert_eq!(request["ruled_out"][0]["option"], "stratified_random");
    assert_eq!(request["ruled_out"][0]["verification"], "no_row_in_both");
    assert!(found.exhausted.is_empty());
}

#[test]
fn a_decision_whose_every_option_is_ruled_out_is_exhausted_not_ready() {
    let ops = operators();
    let catalog = catalog(&ops);
    let mut steps = vec![decided(1, REPEATED, "repeated_items", "independent_rows")];
    for (at, option) in [
        "temporal",
        "item_groups",
        "stratified_random",
        "simple_random",
    ]
    .iter()
    .enumerate()
    {
        let round = 2 * at as u32 + 2;
        steps.push(decided(round, SPLIT, "split_method", option));
        steps.push(checked(round + 1, SPLIT, "no_row_in_both", "fail"));
    }
    let done = made_by(&catalog, &steps).unwrap();
    let q = titled();
    let effective = bindings(&q, &done).unwrap();
    let found = ready(
        &catalog,
        &q,
        &done,
        &effective,
        &groups(0),
        &ops,
        &measured_flow(),
    )
    .unwrap();
    assert!(found.ready.is_empty(), "{:?}", found.ready);
    assert_eq!(found.exhausted.len(), 1);
    assert_eq!(found.exhausted[0].decides, SPLIT);
}

fn ready_ids(
    catalog: &RuleCatalog,
    q: &QuestionVersion,
    done: &[Made],
    measured: &BTreeMap<String, Value>,
    ops: &[Operator],
) -> Vec<String> {
    let effective = bindings(q, done).unwrap();
    ready(
        catalog,
        q,
        done,
        &effective,
        measured,
        ops,
        &measured_flow(),
    )
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
    let found = ready(
        &catalog,
        &q,
        &[],
        &effective,
        &BTreeMap::new(),
        &ops,
        &measured_flow(),
    )
    .unwrap();
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
    let found = ready(
        &catalog,
        &q,
        &[],
        &effective,
        &groups(83),
        &ops,
        &measured_flow(),
    )
    .unwrap();
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
    let found = ready(
        &catalog,
        &q,
        &done,
        &effective,
        &groups(0),
        &ops,
        &measured_flow(),
    )
    .unwrap();
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
    let found = ready(
        &catalog,
        &q,
        &done,
        &effective,
        &BTreeMap::new(),
        &ops,
        &measured_flow(),
    )
    .unwrap();
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
    assert_eq!(applied.promises, ["no_row_in_both"]);
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

#[test]
fn a_decision_reopened_holds_back_the_methods_that_read_it() {
    let ops = operators();
    let catalog = catalog(&ops);
    let steps = [
        decided(1, REPEATED, "repeated_items", "independent_rows"),
        step(
            2,
            "verify",
            json!({ "verifications": [{
            "decides": REPEATED, "method": "methodology.core.repeated_items@1.0.0",
            "verification": "rows_apart", "promise": "Rows are apart.",
            "result": "fail", "detail": "Two rows are one item.",
        }] }),
        ),
    ];
    let done = made_by(&catalog, &steps).unwrap();
    assert_eq!(
        ready_ids(&catalog, &titled(), &done, &groups(0), &ops),
        [REPEATED],
        "the split waits for the items to be decided again"
    );
}

#[test]
fn an_exhausted_decision_names_each_option_and_what_broke_it() {
    let ops = operators();
    let catalog = catalog(&ops);
    let mut steps = vec![decided(1, REPEATED, "repeated_items", "independent_rows")];
    for (at, option) in [
        "temporal",
        "item_groups",
        "stratified_random",
        "simple_random",
    ]
    .iter()
    .enumerate()
    {
        let round = 2 * at as u32 + 2;
        steps.push(decided(round, SPLIT, "split_method", option));
        steps.push(checked(round + 1, SPLIT, "no_row_in_both", "fail"));
    }
    let done = made_by(&catalog, &steps).unwrap();
    let q = titled();
    let effective = bindings(&q, &done).unwrap();
    let found = ready(
        &catalog,
        &q,
        &done,
        &effective,
        &groups(0),
        &ops,
        &measured_flow(),
    )
    .unwrap();
    let detail = found.exhausted[0].detail();
    assert!(
        detail.starts_with("evaluation.split_method: every option broke its promise: temporal (no_row_in_both: 12 test rows"),
        "{detail}"
    );
    assert_eq!(detail.matches("no_row_in_both").count(), 4, "{detail}");
}

#[test]
fn a_decide_step_with_no_option_is_refused_as_broken() {
    let ops = operators();
    let catalog = catalog(&ops);
    let broken = step(1, "decide", json!({ "decides": SPLIT }));
    let error = made_by(&catalog, &[broken]).unwrap_err().to_string();
    assert!(error.contains("decide step 1"), "{error}");
    assert!(!error.contains("cannot add"), "{error}");
}

#[test]
fn a_decision_whose_promise_fails_after_a_comparison_is_not_reopened() {
    let ops = operators();
    let catalog = catalog(&ops);
    let early = [
        decided(1, SPLIT, "split_method", "stratified_random"),
        checked(2, SPLIT, "no_row_in_both", "fail"),
    ];
    let made = made_by(&catalog, &early).unwrap();
    assert_eq!(
        reopened_too_late(&made, &early),
        None,
        "before any comparison"
    );

    let late = [
        decided(1, SPLIT, "split_method", "stratified_random"),
        step(2, "compare", json!({})),
        checked(3, SPLIT, "no_row_in_both", "fail"),
    ];
    let made = made_by(&catalog, &late).unwrap();
    let why = reopened_too_late(&made, &late).unwrap();
    assert!(
        why.contains("evaluation.split_method broke its promise after"),
        "{why}"
    );
}

#[test]
fn a_group_split_moves_its_group_producer_onto_the_rows_the_split_read() {
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
    // A cleaning step decided before the split sits between the load and the split; the
    // producer was placed in the look, on the loaded rows.
    let mut flow = measured_flow();
    flow.nodes.push(
        parse(
            &json!({ "id": "html_text", "operator": "sprisk.clean.strip_html@1.0.0",
                     "params": { "columns": ["description"] } })
            .to_string(),
        )
        .unwrap(),
    );
    flow.edges = parse(
        &json!([
            { "from": "load.data", "to": "near_duplicates.data" },
            { "from": "load.data", "to": "html_text.data" },
            { "from": "html_text.data", "to": "split.data" },
        ])
        .to_string(),
    )
    .unwrap();
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
            { "kind": "set_input", "node_id": "near_duplicates", "port": "data",
              "from": "html_text.data" },
            { "kind": "set_input", "node_id": "split", "port": "data",
              "from": "near_duplicates.data" },
        ])
    );
    let (_, edges) = patch::apply(&flow, &applied.effects, |id| {
        ops.iter().find(|o| o.id.as_str() == id)
    })
    .unwrap();
    let edges: Vec<String> = edges
        .iter()
        .map(|e| format!("{} -> {}", e.from.as_str(), e.to.as_str()))
        .collect();
    assert!(
        edges.contains(&"html_text.data -> near_duplicates.data".to_owned()),
        "{edges:?}"
    );
    assert!(
        edges.contains(&"near_duplicates.data -> split.data".to_owned()),
        "{edges:?}"
    );
    assert!(
        !edges.contains(&"load.data -> near_duplicates.data".to_owned()),
        "{edges:?}"
    );
}

#[test]
fn a_join_reads_the_loaded_table_only_a_producer_reads() {
    let ops = operators();
    let packs = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology");
    let catalog = RuleCatalog::load_dir(&packs, &ops).unwrap();
    let method = catalog
        .methods()
        .find(|m| m.decides.as_str() == "data.join_sources")
        .unwrap();
    let flow: PipelineVersion = parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                { "id": "load", "operator": "sprisk.io.file_source@1.0.0",
                  "params": { "path": "items.csv", "format": "csv" } },
                { "id": "codes", "operator": "sprisk.io.file_source@1.0.0",
                  "params": { "path": "codes.csv", "format": "csv" } },
                { "id": "join_keys", "operator": "sprisk.profile.join_keys@1.0.0", "params": {} },
                { "id": "split", "operator": "sprisk.validation.random_split@1.0.0",
                  "params": { "test_fraction": 0.2, "seed": 42 } },
            ],
            "edges": [
                { "from": "load.data", "to": "join_keys.data" },
                { "from": "codes.data", "to": "join_keys.other" },
                { "from": "load.data", "to": "split.data" },
            ],
            "created_at": "2026-10-25T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap();
    let measured = BTreeMap::from([(
        "data.join_keys".to_owned(),
        json!({ "unread_tables": 1, "rows": 3, "shared": ["unnamed_0"], "key": "unnamed_0",
                "matched_rows": 3, "most_rows_per_key": 1 }),
    )]);
    let applied = apply_option(
        method,
        "join_on_key",
        MethodAssurance::Rule,
        &[],
        &flow,
        &ops,
        &measured,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&applied.effects).unwrap(),
        json!([{ "kind": "insert_node", "node_id": "join", "operator": "sprisk.io.join@1.0.0",
                 "params": { "key": "unnamed_0" }, "before": "split", "other": "codes.data" }])
    );
}

#[test]
fn a_join_with_no_second_table_decides_without_evidence() {
    let ops = operators();
    let packs = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology");
    let catalog = RuleCatalog::load_dir(&packs, &ops).unwrap();
    let q = titled();
    let effective = bindings(&q, &[]).unwrap();
    let found = ready(
        &catalog,
        &q,
        &[],
        &effective,
        &BTreeMap::new(),
        &ops,
        &measured_flow(),
    )
    .unwrap();
    let ready: Vec<&str> = found
        .ready
        .iter()
        .map(|r| r.method.decides.as_str())
        .collect();
    assert!(ready.contains(&"data.join_sources"), "{ready:?}");
    // Its producer would read every row with no unbound required concept: it waits to measure.
    assert!(!ready.contains(&"data.html_text"), "{ready:?}");
}
