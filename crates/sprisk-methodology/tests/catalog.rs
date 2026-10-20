#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use sprisk_methodology::{CatalogError, RuleCatalog};

fn repo_methodology() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology")
}

fn rule_yaml(id: &str, decides: &str) -> String {
    format!(
        "schema_version: sprisk.methodology_rule/v1
id: {id}
name: Test rule
stage: cleaning
decides: {decides}
provenance: {{ standard: s, citation: c, pitfall: p, corner_cases: [] }}
observes: []
policy_thresholds: {{}}
alternatives:
  - {{ id: keep, label: Keep, description: d, condition: always, rationale: r, action: {{ type: pass_through }} }}
verification: {{ check_id: sprisk.checks.x@1.0.0, invariant: i }}
"
    )
}

fn write_rule(root: &Path, folder: &str, id: &str, decides: &str) {
    let dir = root.join("pack/rules").join(folder);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("rule.yaml"), rule_yaml(id, decides)).unwrap();
}

#[test]
fn every_rule_in_the_repo_loads_with_its_manifest_as_source() {
    let catalog = RuleCatalog::load_dir(&repo_methodology()).unwrap();
    assert_eq!(catalog.rules().count(), 30);

    let source = catalog
        .source("methodology.supervised.multicollinearity@1.0.0")
        .unwrap();
    assert_eq!(source.files[0].path.as_str(), "rule.yaml");
    assert!(
        source.files[0]
            .text
            .contains("decides: features.multicollinearity_strategy")
    );
}

#[test]
fn a_python_module_beside_the_manifest_is_served_as_source() {
    let dir = tempfile::tempdir().unwrap();
    write_rule(dir.path(), "a", "methodology.pack.a@1.0.0", "cleaning.a");
    fs::write(
        dir.path().join("pack/rules/a/rule.py"),
        "def decide(observation, settings):\n    return None\n",
    )
    .unwrap();

    let catalog = RuleCatalog::load_dir(dir.path()).unwrap();
    let paths: Vec<_> = catalog
        .source("methodology.pack.a@1.0.0")
        .unwrap()
        .files
        .iter()
        .map(|f| f.path.as_str())
        .collect();
    assert_eq!(paths, ["rule.yaml", "rule.py"]);
}

#[test]
fn two_rules_owning_the_same_decision_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    write_rule(dir.path(), "a", "methodology.pack.a@1.0.0", "cleaning.same");
    write_rule(dir.path(), "b", "methodology.pack.b@1.0.0", "cleaning.same");

    let err = RuleCatalog::load_dir(dir.path()).unwrap_err();
    assert!(
        matches!(err, CatalogError::DuplicateDecision { .. }),
        "{err}"
    );
}

#[test]
fn an_invalid_manifest_is_refused_with_its_path() {
    let dir = tempfile::tempdir().unwrap();
    write_rule(dir.path(), "a", "not-a-rule-id", "cleaning.a");

    let err = RuleCatalog::load_dir(dir.path()).unwrap_err();
    assert!(err.to_string().contains("pack/rules/a/rule.yaml"), "{err}");
}

#[test]
fn an_unknown_rule_has_no_source() {
    let catalog = RuleCatalog::load_dir(&repo_methodology()).unwrap();
    assert!(matches!(
        catalog.source("methodology.pack.none@1.0.0"),
        Err(CatalogError::UnknownRule(_))
    ));
}

#[test]
fn one_rule_id_in_two_folders_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    write_rule(dir.path(), "a", "methodology.pack.a@1.0.0", "cleaning.a");
    write_rule(dir.path(), "b", "methodology.pack.a@1.0.0", "cleaning.b");

    let err = RuleCatalog::load_dir(dir.path()).unwrap_err();
    assert!(matches!(err, CatalogError::DuplicateId { .. }), "{err}");
}

#[test]
fn a_manifest_that_is_not_yaml_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let rule = dir.path().join("pack/rules/a");
    fs::create_dir_all(&rule).unwrap();
    fs::write(rule.join("rule.yaml"), "id: [unclosed\n").unwrap();

    let err = RuleCatalog::load_dir(dir.path()).unwrap_err();
    assert!(matches!(err, CatalogError::Yaml { .. }), "{err}");
}
