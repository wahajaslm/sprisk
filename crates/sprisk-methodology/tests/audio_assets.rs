//! An audio step reads files, not a column: the engine fills its folder and path settings from
//! the question's audio asset binding (ADR-0066).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::{MethodAssurance, Operator, PipelineVersion, QuestionVersion, parse};
use sprisk_methodology::RuleCatalog;
use sprisk_methodology::deciding::{Basis, apply_option, bindings};
use sprisk_methodology::measure::measure;
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
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/audio_modality");
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

fn load_split() -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                { "id": "load", "operator": "sprisk.io.file_source@1.0.0",
                  "params": { "path": "tracks.csv", "format": "csv" } },
                { "id": "split", "operator": "sprisk.validation.random_split@1.0.0",
                  "params": { "test_fraction": 0.2, "seed": 42 } },
            ],
            "edges": [{ "from": "load.data", "to": "split.data" }],
            "created_at": "2026-11-07T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

#[test]
fn an_audio_producer_reads_the_folder_and_path_column_the_question_declares() {
    let ops = operators();
    let q = question(
        json!([{ "modality": "audio", "asset_root": "data/genre_mix",
        "link_column": "audio_path", "origin": "explicit" }]),
    );
    let measured = measure(&catalog(&ops), &load_split(), &q, &[], &ops, &[]).unwrap();
    let effects = serde_json::to_value(&measured.effects).unwrap();
    let audit = effects
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["operator"] == "sprisk.clean.audit_audio@1.0.0")
        .unwrap_or_else(|| panic!("the audit is added: {effects}"));
    assert_eq!(
        audit["params"],
        json!({ "audio_dir": "data/genre_mix", "audio_path_column": "audio_path" })
    );
}

#[test]
fn a_step_an_option_inserts_reads_the_files_the_question_declares() {
    // The real audio pack: dropping repeated recordings inserts a step that reads the files.
    let ops = operators();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let catalog = RuleCatalog::load_dir(&root.join("methodology"), &ops).unwrap();
    let method = catalog
        .methods()
        .find(|m| m.decides.as_str() == "data.same_recording")
        .unwrap();
    let q = question(
        json!([{ "modality": "audio", "asset_root": "data/genre_mix",
        "link_column": "audio_path", "origin": "explicit" }]),
    );
    let effective = bindings(&q, &[]).unwrap();
    let applied = apply_option(
        method,
        "drop",
        MethodAssurance::Rule,
        &Basis {
            bindings: &effective.bindings,
            pipeline: &load_split(),
            operators: &ops,
            measured: &BTreeMap::new(),
            question: &q,
        },
    )
    .unwrap();
    let effects = serde_json::to_value(&applied.effects).unwrap();
    assert_eq!(
        effects[0]["params"],
        json!({ "audio_dir": "data/genre_mix", "audio_path_column": "audio_path" }),
        "{effects}"
    );
}
