//! A method applies by the question's task and, for a pack such as audio, by the kind of
//! files the question declares (ADR-0066).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{Operator, QuestionVersion, parse};
use sprisk_methodology::RuleCatalog;
use sprisk_methodology::measure::fitting;
use sprisk_registry::Registry;

fn operators() -> Vec<Operator> {
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    Registry::load_dir(&plugins)
        .unwrap()
        .operators()
        .cloned()
        .collect()
}

fn catalog() -> RuleCatalog {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio_modality");
    RuleCatalog::load_dir(&fixture.join("methodology"), &operators()).unwrap()
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

fn decided_by(question: &QuestionVersion) -> Vec<String> {
    let catalog = catalog();
    fitting(&catalog, question)
        .map(|m| m.decides.as_str().to_owned())
        .collect()
}

#[test]
fn an_audio_method_applies_when_the_question_declares_audio_files() {
    let audio = json!([{ "modality": "audio", "asset_root": "data/genre_mix",
        "link_column": "audio_path", "origin": "explicit" }]);
    assert_eq!(decided_by(&question(audio)), ["data.audio_decode_coverage"]);
}

#[test]
fn an_audio_method_is_left_out_without_audio_files() {
    // Images are files too, but not the kind the method reads.
    let images = json!([{ "modality": "image", "asset_root": "data/photos",
        "link_column": "photo", "origin": "explicit" }]);
    assert!(decided_by(&question(images)).is_empty());
    assert!(decided_by(&question(json!([]))).is_empty());
}
