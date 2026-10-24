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
fn a_supervised_model_without_an_estimator_or_complexity_names_the_file() {
    for model in [
        "model: { tasks: [classification], complexity: 1 }\n",
        "model: { tasks: [classification], estimator: \"m:build\" }\n",
    ] {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "bad/manifest.yaml", &format!("{SPLIT}{model}"));

        let err = Registry::load_dir(dir.path()).unwrap_err();

        assert!(
            matches!(err, RegistryError::IncompleteModel { .. }),
            "{err}"
        );
        assert!(err.to_string().contains("bad/manifest.yaml"), "{err}");
    }
}

#[test]
fn only_a_matrix_input_may_be_optional() {
    let dir = tempfile::tempdir().unwrap();
    let optional = SPLIT.replace(
        "inputs: [{ name: data, kind: table }]",
        "inputs: [{ name: data, kind: table, optional: true }]",
    );
    write(dir.path(), "bad/manifest.yaml", &optional);

    let err = Registry::load_dir(dir.path()).unwrap_err();

    assert!(matches!(err, RegistryError::OptionalInput { .. }), "{err}");
    assert!(err.to_string().contains("bad/manifest.yaml"), "{err}");
    assert!(err.to_string().contains("input data"), "{err}");

    let dir = tempfile::tempdir().unwrap();
    let words = SPLIT.replace(
        "inputs: [{ name: data, kind: table }]",
        "inputs: [{ name: data, kind: table }, { name: words, kind: matrix, optional: true }]",
    );
    write(dir.path(), "ok/manifest.yaml", &words);
    assert_eq!(Registry::load_dir(dir.path()).unwrap().len(), 1);
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
    assert_eq!(registry.len(), 45);
    assert!(
        registry
            .get("sprisk.validation.group_overlap@1.0.0")
            .is_some()
    );
    assert!(
        registry
            .get("sprisk.validation.class_shares@2.0.0")
            .is_some()
    );
    assert!(registry.get("sprisk.ml.linear_model@3.0.0").is_some());
    assert!(registry.get("sprisk.clean.spectral_gating@1.0.0").is_some());
}

#[test]
fn every_core_plugin_step_has_a_title_for_people() {
    let plugins = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    let registry = Registry::load_dir(&plugins).unwrap();
    let untitled: Vec<&str> = registry
        .operators()
        .filter(|o| o.title.is_none())
        .map(|o| o.id.as_str())
        .collect();
    assert!(untitled.is_empty(), "no title: {untitled:?}");
}

const ID: &str = "sprisk.validation.temporal_split@1.0.0";

fn pack(root: &Path, code: &str) -> String {
    write(root, "pack/pyproject.toml", "[project]\nname = \"p\"\n");
    write(root, "pack/operators/split/manifest.yaml", SPLIT);
    write(root, "pack/src/p/split.py", code);
    Registry::load_dir(root)
        .unwrap()
        .digest(ID)
        .unwrap()
        .to_owned()
}

#[test]
fn implementation_digest_follows_the_pack_source_code() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let first = pack(a.path(), "def split(): ...");
    assert_eq!(
        pack(b.path(), "def split(): ..."),
        first,
        "same code, same digest"
    );
    assert!(first.starts_with("sha256:"));

    assert_ne!(
        pack(a.path(), "def split(): return 1"),
        first,
        "edited code, new digest"
    );
}

#[test]
fn implementation_digest_ignores_bytecode_caches() {
    let dir = tempfile::tempdir().unwrap();
    let first = pack(dir.path(), "def split(): ...");
    write(
        dir.path(),
        "pack/src/p/__pycache__/split.cpython-312.pyc",
        "bytes",
    );
    let registry = Registry::load_dir(dir.path()).unwrap();
    assert_eq!(registry.digest(ID).unwrap(), first);
}

#[test]
fn manifest_without_a_python_pack_is_digested_alone() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "loose/manifest.yaml", SPLIT);
    let first = Registry::load_dir(dir.path())
        .unwrap()
        .digest(ID)
        .unwrap()
        .to_owned();
    write(
        dir.path(),
        "loose/manifest.yaml",
        &format!("{SPLIT}description: edited\n"),
    );
    let second = Registry::load_dir(dir.path())
        .unwrap()
        .digest(ID)
        .unwrap()
        .to_owned();
    assert_ne!(first, second, "the manifest alone still changes the digest");
}

fn pack_with_source(root: &Path, entrypoint: &str) {
    write(root, "validation/pyproject.toml", "");
    write(
        root,
        "validation/operators/split/manifest.yaml",
        &SPLIT.replace(
            "sprisk_validation.temporal_split:temporal_split",
            entrypoint,
        ),
    );
    write(
        root,
        "validation/src/sprisk_validation/temporal_split.py",
        "def temporal_split(params, inputs, out_dir):\n    return []\n",
    );
}

#[test]
fn source_is_the_entrypoint_module_with_the_implementation_digest() {
    let dir = tempfile::tempdir().unwrap();
    pack_with_source(
        dir.path(),
        "sprisk_validation.temporal_split:temporal_split",
    );
    let registry = Registry::load_dir(dir.path()).unwrap();
    let id = "sprisk.validation.temporal_split@1.0.0";

    let source = registry.source(id).unwrap();

    assert_eq!(source.path, "sprisk_validation/temporal_split.py");
    assert!(source.text.starts_with("def temporal_split"));
    assert_eq!(source.digest.as_str(), registry.digest(id).unwrap());
}

#[test]
fn source_of_an_unknown_operator_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    pack_with_source(
        dir.path(),
        "sprisk_validation.temporal_split:temporal_split",
    );
    let registry = Registry::load_dir(dir.path()).unwrap();
    assert!(matches!(
        registry.source("acme.io.csv@0.1.0"),
        Err(RegistryError::UnknownOperator(_))
    ));
}

#[test]
fn source_of_a_missing_module_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    pack_with_source(dir.path(), "sprisk_validation.missing:run");
    let registry = Registry::load_dir(dir.path()).unwrap();
    assert!(matches!(
        registry.source("sprisk.validation.temporal_split@1.0.0"),
        Err(RegistryError::NoSource { .. })
    ));
}

#[cfg(unix)]
#[test]
fn source_never_follows_a_link_out_of_the_pack() {
    let dir = tempfile::tempdir().unwrap();
    pack_with_source(dir.path(), "sprisk_validation.leak:run");
    write(dir.path(), "secret.py", "TOKEN = 'x'\n");
    std::os::unix::fs::symlink(
        dir.path().join("secret.py"),
        dir.path().join("validation/src/sprisk_validation/leak.py"),
    )
    .unwrap();
    let registry = Registry::load_dir(dir.path()).unwrap();
    assert!(matches!(
        registry.source("sprisk.validation.temporal_split@1.0.0"),
        Err(RegistryError::NoSource { .. })
    ));
}

const FOREST: &str = r#"
schema_version: sprisk.operator/v1
id: sprisk.test.forest@1.0.0
capability_class: estimator
entrypoint: m:fit
inputs: [{ name: train, kind: table }]
outputs: [{ name: model, kind: model }]
params_schema:
  type: object
  properties:
    target: { type: string }
    features: { type: array }
    task: { type: string }
    seed: { type: integer, minimum: 0 }
    min_samples_leaf: { type: integer, minimum: 1 }
effects: pure
network: none
resources: { cpu_cores: 1, memory_mb: 512, gpu: none, timeout_seconds: 60 }
"#;

fn forest_searching(search: &str) -> String {
    format!(
        "{FOREST}model: {{ family: tree_ensemble, tasks: [classification], estimator: \"m:build\", complexity: 2, search: {search} }}\n"
    )
}

#[test]
fn a_model_s_search_is_kept_in_manifest_order() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "forest/manifest.yaml",
        &forest_searching("[{ name: min_samples_leaf, values: [1, 5, 20] }]"),
    );
    let registry = Registry::load_dir(dir.path()).unwrap();
    let search = &registry
        .get("sprisk.test.forest@1.0.0")
        .unwrap()
        .model
        .as_ref()
        .unwrap()
        .search;
    assert_eq!(search[0].name.as_str(), "min_samples_leaf");
    assert_eq!(search[0].values, [1, 5, 20].map(serde_json::Value::from));
}

#[test]
fn a_search_the_model_cannot_take_is_refused_naming_the_file_and_why() {
    let cases = [
        (
            "[{ name: max_depth, values: [3, 6] }]",
            "max_depth is not a params property",
        ),
        (
            "[{ name: target, values: [a, b] }]",
            "target is fixed by the flow",
        ),
        (
            "[{ name: seed, values: [0, 1] }]",
            "seed is fixed by the flow",
        ),
        (
            "[{ name: min_samples_leaf, values: [0, 5] }]",
            "min_samples_leaf: 0 is not a valid value",
        ),
        (
            "[{ name: min_samples_leaf, values: [5] }]",
            "min_samples_leaf needs at least two values",
        ),
        (
            "[{ name: min_samples_leaf, values: [5, 5] }]",
            "min_samples_leaf lists 5 twice",
        ),
        (
            "[{ name: min_samples_leaf, values: [1, 5] }, { name: min_samples_leaf, values: [2, 3] }]",
            "min_samples_leaf is searched twice",
        ),
        (
            "[{ name: min_samples_leaf, values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }, \
              { name: target, values: [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o] }]",
            "the search has 225 combinations; at most 200",
        ),
    ];
    for (search, why) in cases {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "bad/manifest.yaml", &forest_searching(search));
        let err = Registry::load_dir(dir.path()).unwrap_err();
        assert!(
            matches!(err, RegistryError::BadSearch { .. }),
            "{search}: {err}"
        );
        let text = err.to_string();
        assert!(text.contains("bad/manifest.yaml"), "{text}");
        assert!(text.contains(why), "{search}: {text}");
    }
}
