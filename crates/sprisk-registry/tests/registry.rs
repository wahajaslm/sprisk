#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::Path;

use sprisk_registry::{Registry, RegistryError};

const SPLIT: &str = r#"
schema_version: sprisk.operator/v1
id: sprisk.validation.temporal_split@1.0.0
capability_class: transform
entrypoint: sprisk_validation.temporal_split:temporal_split
inputs: [{ name: data, kind: table }]
outputs: [{ name: train, kind: table }, { name: validation, kind: table }]
params_schema: { type: object }
effects: pure
network: none
resources: { cpu_cores: 1, memory_mb: 512, gpu: none, timeout_seconds: 60 }
"#;

fn write(root: &Path, rel: &str, body: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, body).unwrap();
}

fn with_id(id: &str) -> String {
    SPLIT.replace("sprisk.validation.temporal_split@1.0.0", id)
}

#[test]
fn loads_manifests_from_nested_dirs_and_ignores_other_files() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "core-data/operators/split/manifest.yaml", SPLIT);
    write(
        dir.path(),
        "acme/operators/csv/manifest.yaml",
        &with_id("acme.io.csv@0.1.0"),
    );
    write(dir.path(), "core-data/README.md", "not a manifest");

    let registry = Registry::load_dir(dir.path()).unwrap();

    assert_eq!(registry.len(), 2);
    let split = registry
        .get("sprisk.validation.temporal_split@1.0.0")
        .unwrap();
    assert_eq!(split.outputs.len(), 2);
    assert!(registry.get("acme.io.csv@0.1.0").is_some());
}

#[test]
fn unknown_operator_is_none() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "a/manifest.yaml", SPLIT);
    let registry = Registry::load_dir(dir.path()).unwrap();
    assert!(
        registry
            .get("sprisk.validation.temporal_split@9.9.9")
            .is_none()
    );
}

#[test]
fn duplicate_operator_id_names_both_files() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "a/manifest.yaml", SPLIT);
    write(dir.path(), "b/manifest.yaml", SPLIT);

    let err = Registry::load_dir(dir.path()).unwrap_err();

    let msg = err.to_string();
    assert!(matches!(err, RegistryError::Duplicate { .. }), "{msg}");
    assert!(
        msg.contains("a/manifest.yaml") && msg.contains("b/manifest.yaml"),
        "{msg}"
    );
}

#[test]
fn manifest_violating_the_contract_names_the_file() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "bad/manifest.yaml",
        &SPLIT.replace("effects: pure\n", ""),
    );

    let err = Registry::load_dir(dir.path()).unwrap_err();

    assert!(matches!(err, RegistryError::Invalid { .. }), "{err}");
    assert!(err.to_string().contains("bad/manifest.yaml"), "{err}");
}

#[test]
fn yaml_null_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "bad/manifest.yaml",
        &format!("{SPLIT}description: ~\n"),
    );
    let err = Registry::load_dir(dir.path()).unwrap_err();
    assert!(matches!(err, RegistryError::Invalid { .. }), "{err}");
}

#[test]
fn malformed_yaml_names_the_file() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "bad/manifest.yaml", "id: [unclosed");

    let err = Registry::load_dir(dir.path()).unwrap_err();

    assert!(matches!(err, RegistryError::Yaml { .. }), "{err}");
    assert!(err.to_string().contains("bad/manifest.yaml"), "{err}");
}

#[test]
fn every_core_plugin_manifest_is_valid() {
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    let registry = Registry::load_dir(&plugins).unwrap();
    assert_eq!(registry.len(), 7);
    assert!(registry.get("sprisk.ml.linear_model@1.0.0").is_some());
}
