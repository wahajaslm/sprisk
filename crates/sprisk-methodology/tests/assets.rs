#![allow(clippy::unwrap_used, clippy::expect_used)]

//! Asset steps take their folder and file name from the question's asset bindings
//! (ADR-0063 amendment, 27 Oct).

use serde_json::{Value, json};
use sprisk_contracts::{QuestionVersion, parse};
use sprisk_methodology::asset_params;

fn question(assets: Value) -> QuestionVersion {
    parse(
        &json!({
            "schema_version": "sprisk.question_version/v1",
            "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "objective": { "value": "Tell each listing's product type.", "origin": "explicit" },
            "task": { "value": "classification", "origin": "explicit" },
            "assumptions": [], "unknowns": [], "acceptance_criteria": [],
            "asset_bindings": assets,
            "created_at": "2026-10-27T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap()
}

fn operator(id: &str) -> sprisk_contracts::Operator {
    let plugins = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    sprisk_registry::Registry::load_dir(&plugins)
        .unwrap()
        .get(id)
        .unwrap()
        .clone()
}

#[test]
fn an_image_step_takes_the_bound_folder_and_file_pattern() {
    let q = question(json!([
        { "modality": "audio", "asset_root": "/data/clips", "link_column": "clip", "origin": "explicit" },
        { "modality": "image", "asset_root": "/data/images", "link_column": "imageid",
          "file_pattern": "image_{imageid}_product_{productid}.jpg", "origin": "explicit" },
    ]));
    assert_eq!(
        Value::Object(asset_params(
            &operator("sprisk.clean.audit_images@1.0.0"),
            &q
        )),
        json!({ "image_dir": "/data/images", "file_pattern": "image_{imageid}_product_{productid}.jpg" })
    );
}

#[test]
fn without_a_pattern_the_link_column_names_the_file() {
    let q = question(json!([
        { "modality": "audio", "asset_root": "/data/clips", "link_column": "clip", "origin": "confirmed" },
    ]));
    assert_eq!(
        Value::Object(asset_params(
            &operator("sprisk.clean.audit_audio@1.0.0"),
            &q
        )),
        json!({ "audio_dir": "/data/clips", "file_pattern": "{clip}" })
    );
}

#[test]
fn an_unbound_kind_of_file_fills_nothing() {
    let q = question(json!([]));
    assert!(asset_params(&operator("sprisk.clean.audit_audio@1.0.0"), &q).is_empty());
}

fn walk_measures(assets: Value) -> Vec<Value> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let ops: Vec<sprisk_contracts::Operator> =
        sprisk_registry::Registry::load_dir(&root.join("plugins"))
            .unwrap()
            .operators()
            .cloned()
            .collect();
    let catalog =
        sprisk_methodology::RuleCatalog::load_dir(&root.join("methodology"), &ops).unwrap();
    let mut q = serde_json::to_value(question(assets)).unwrap();
    q["target"] = json!({ "value": "prdtypecode", "origin": "explicit" });
    let q: QuestionVersion = parse(&q.to_string()).unwrap();
    let flow: sprisk_contracts::PipelineVersion = parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                { "id": "load", "operator": "sprisk.io.file_source@1.0.0", "params": { "path": "x.csv", "format": "csv" } },
                { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": { "test_fraction": 0.2, "seed": 0 } },
            ],
            "edges": [{ "from": "load.data", "to": "split.data" }],
            "created_at": "2026-10-27T10:00:00Z",
        })
        .to_string(),
    )
    .unwrap();
    let measured =
        sprisk_methodology::measure::measure(&catalog, &flow, &q, &[], &ops, &[]).unwrap();
    serde_json::to_value(&measured.effects)
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| {
            e["operator"]
                .as_str()
                .is_some_and(|o| o.starts_with("sprisk.clean.audit_"))
        })
        .cloned()
        .collect()
}

#[test]
fn bound_images_are_audited_before_the_split_from_the_bound_folder() {
    let audits = walk_measures(json!([
        { "modality": "image", "asset_root": "/data/images", "link_column": "imageid",
          "file_pattern": "image_{imageid}_product_{productid}.jpg", "origin": "explicit" },
    ]));
    assert_eq!(audits.len(), 1, "{audits:?}");
    assert_eq!(audits[0]["operator"], "sprisk.clean.audit_images@1.0.0");
    assert_eq!(
        audits[0]["params"],
        json!({ "image_dir": "/data/images", "file_pattern": "image_{imageid}_product_{productid}.jpg" })
    );
}

#[test]
fn a_question_binding_no_files_audits_none() {
    assert!(walk_measures(json!([])).is_empty());
}
