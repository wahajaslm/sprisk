//! A method waits for the decisions it reads, but only those some method fitting the question
//! makes: a split reading the audio pack's recording group waits on audio questions only
//! (ADR-0066).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{Operator, PipelineVersion, QuestionVersion, parse};
use sprisk_methodology::RuleCatalog;
use sprisk_methodology::deciding::{bindings, ready};
use sprisk_registry::Registry;

fn operators() -> Vec<Operator> {
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    Registry::load_dir(&plugins)
        .unwrap()
        .operators()
        .cloned()
        .collect()
}

fn catalog(ops: &[Operator]) -> RuleCatalog {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio_split_order");
    RuleCatalog::load_dir(&fixture.join("methodology"), ops).unwrap()
}

fn question(asset_bindings: Value) -> QuestionVersion {
    parse(
        &json!({
            "schema_version": "sprisk.question_version/v1",
            "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "objective": { "value": "Tell Eastern music from the rest.", "origin": "explicit" },
            "task": { "value": "classification", "origin": "explicit" },
            "target": { "value": "is_eastern", "origin": "explicit" },
            "assumptions": [], "unknowns": [], "acceptance_criteria": [],
            "asset_bindings": asset_bindings,
            "created_at": "2026-11-07T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

fn flow() -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [{ "id": "load", "operator": "sprisk.io.file_source@1.0.0",
                        "params": { "path": "tracks.csv", "format": "csv" } }],
            "edges": [], "created_at": "2026-11-07T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

fn ready_now(question: &QuestionVersion) -> Vec<String> {
    let ops = operators();
    let catalog = catalog(&ops);
    let effective = bindings(question, &[]).unwrap();
    ready(
        &catalog,
        question,
        &[],
        &effective,
        &BTreeMap::new(),
        &ops,
        &flow(),
    )
    .unwrap()
    .ready
    .iter()
    .map(|r| r.method.decides.to_string())
    .collect()
}

#[test]
fn on_audio_files_the_split_waits_for_who_made_each_recording() {
    let audio = json!([{ "modality": "audio", "asset_root": "data/genre_mix",
        "link_column": "audio_path", "origin": "explicit" }]);
    assert_eq!(ready_now(&question(audio)), ["data.recording_group"]);
}

#[test]
fn without_audio_files_no_method_makes_the_decision_so_the_split_goes_ahead() {
    assert_eq!(ready_now(&question(json!([]))), ["split.method"]);
}

#[test]
fn a_conditional_method_sits_just_before_its_first_reader_and_the_rest_keep_their_order() {
    // The real packs: adding the audio pack must not move the split behind the cleaning
    // decisions on questions that have no audio files.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let ops = operators();
    let catalog = RuleCatalog::load_dir(&root.join("methodology"), &ops).unwrap();
    let order: Vec<String> = catalog.methods().map(|m| m.decides.to_string()).collect();
    let at = |decides: &str| order.iter().position(|d| d == decides).unwrap();
    assert_eq!(
        at("data.recording_group") + 1,
        at("split.method"),
        "{order:?}"
    );
    assert_eq!(
        at("data.repeated_items") + 2,
        at("split.method"),
        "{order:?}"
    );
}
