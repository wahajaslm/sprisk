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
status: draft
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

/// An active rule; `extra` is spliced into the manifest's top level.
fn active_yaml(id: &str, decides: &str, applies_to: &str, extra: &str) -> String {
    format!(
        "schema_version: sprisk.methodology_rule/v1
id: {id}
name: Test rule
stage: cleaning
decides: {decides}
status: active
applies_to: [{applies_to}]
provenance: {{ standard: s, citation: c, pitfall: p, corner_cases: [] }}
policy_thresholds: {{}}
alternatives:
  - {{ id: keep, label: Keep, description: d, rationale: r, action: {{ type: remove_node }} }}
verification: {{ check_id: sprisk.checks.x@1.0.0, invariant: i }}
{extra}"
    )
}

const READS_AND_EXAMPLE: &str =
    "reads: [question.target]\nexamples: [{ given: {}, picks: keep }]\n";

fn write_active(root: &Path, folder: &str, manifest: &str) {
    let dir = root.join("pack/rules").join(folder);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("rule.yaml"), manifest).unwrap();
    fs::write(
        dir.join("rule.py"),
        "def decide(observation):\n    return None\n",
    )
    .unwrap();
}

fn refused(manifest: &str) -> String {
    let dir = tempfile::tempdir().unwrap();
    write_active(dir.path(), "a", manifest);
    RuleCatalog::load_dir(dir.path()).unwrap_err().to_string()
}

#[test]
fn every_rule_in_the_repo_loads_with_its_manifest_as_source() {
    let catalog = RuleCatalog::load_dir(&repo_methodology()).unwrap();
    assert_eq!(catalog.rules().count(), 31);

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
    write_active(
        dir.path(),
        "a",
        &active_yaml(
            "methodology.pack.a@1.0.0",
            "cleaning.a",
            "sprisk.clean.scale",
            READS_AND_EXAMPLE,
        ),
    );

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
fn a_step_is_routed_to_the_active_rule_that_applies_to_its_operator() {
    let catalog = RuleCatalog::load_dir(&repo_methodology()).unwrap();
    let rule = catalog
        .rules_for_operator("sprisk.clean.scale@1.0.0")
        .next()
        .unwrap();
    assert_eq!(
        rule.id.to_string(),
        "methodology.supervised.feature_scaling@3.0.0"
    );
    assert!(
        catalog
            .rules_for_operator("sprisk.io.file_source@1.0.0")
            .next()
            .is_none()
    );
}

#[test]
fn an_active_rule_without_rule_py_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let rule = dir.path().join("pack/rules/a");
    fs::create_dir_all(&rule).unwrap();
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        READS_AND_EXAMPLE,
    );
    fs::write(rule.join("rule.yaml"), manifest).unwrap();
    let err = RuleCatalog::load_dir(dir.path()).unwrap_err().to_string();
    assert!(err.contains("rule.py"), "{err}");
}

#[test]
fn a_draft_rule_with_code_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    write_rule(dir.path(), "a", "methodology.pack.a@1.0.0", "cleaning.a");
    fs::write(
        dir.path().join("pack/rules/a/rule.py"),
        "def decide(o):\n    return None\n",
    )
    .unwrap();
    let err = RuleCatalog::load_dir(dir.path()).unwrap_err().to_string();
    assert!(err.contains("draft"), "{err}");
}

#[test]
fn an_active_rule_with_a_condition_is_refused() {
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        READS_AND_EXAMPLE,
    )
    .replace("rationale: r,", "condition: always, rationale: r,");
    assert!(refused(&manifest).contains("condition"));
}

#[test]
fn an_active_rule_with_observes_is_refused() {
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        &format!(
            "{READS_AND_EXAMPLE}observes: [{{ fact: question.target, description: d, required: true }}]\n"
        ),
    );
    assert!(refused(&manifest).contains("observes"));
}

#[test]
fn an_active_rule_reading_a_fact_no_one_sends_is_refused() {
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        "reads: [question.expected_cluster_geometry]\nexamples: [{ given: {}, picks: keep }]\n",
    );
    assert!(refused(&manifest).contains("question.expected_cluster_geometry"));
}

#[test]
fn an_active_rule_needs_examples() {
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        "reads: []\n",
    );
    assert!(refused(&manifest).contains("examples"));
}

#[test]
fn an_example_picking_an_alternative_not_on_the_menu_is_refused() {
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        "reads: []\nexamples: [{ given: {}, picks: other }]\n",
    );
    assert!(refused(&manifest).contains("other"));
}

#[test]
fn an_example_giving_a_fact_the_rule_does_not_read_is_refused() {
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        "reads: []\nexamples: [{ given: { question.target: y }, picks: keep }]\n",
    );
    assert!(refused(&manifest).contains("question.target"));
}

#[test]
fn a_step_has_each_active_rule_that_decides_something_about_it_in_workflow_order() {
    // ADR-0053: one rule per decision on a step, ordered by stage, then id.
    let dir = tempfile::tempdir().unwrap();
    for (folder, id, decides, stage) in [
        ("a", "methodology.pack.a@1.0.0", "cleaning.a", "evaluation"),
        ("b", "methodology.pack.b@1.0.0", "cleaning.b", "models"),
    ] {
        let manifest = active_yaml(id, decides, "sprisk.clean.scale", READS_AND_EXAMPLE)
            .replace("stage: cleaning", &format!("stage: {stage}"));
        write_active(dir.path(), folder, &manifest);
    }
    let catalog = RuleCatalog::load_dir(dir.path()).unwrap();
    let decides: Vec<String> = catalog
        .rules_for_operator("sprisk.clean.scale@1.0.0")
        .map(|rule| rule.decides.to_string())
        .collect();
    assert_eq!(decides, ["cleaning.b", "cleaning.a"]);
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

#[test]
fn an_active_rule_needs_applies_to() {
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "x",
        READS_AND_EXAMPLE,
    )
    .replace("applies_to: [x]\n", "");
    assert!(refused(&manifest).contains("applies_to"));
}

#[test]
fn a_draft_rule_is_never_routed() {
    let dir = tempfile::tempdir().unwrap();
    write_rule(dir.path(), "a", "methodology.pack.a@1.0.0", "cleaning.a");
    let path = dir.path().join("pack/rules/a/rule.yaml");
    let manifest = fs::read_to_string(&path).unwrap().replace(
        "status: draft\n",
        "status: draft\napplies_to: [sprisk.clean.scale]\n",
    );
    fs::write(&path, manifest).unwrap();
    let err = RuleCatalog::load_dir(dir.path()).unwrap_err().to_string();
    assert!(err.contains("applies_to"), "{err}");
}

/// An active shortlist rule; its candidates come from the registry.
fn shortlist_yaml(alternatives: &str, examples: &str) -> String {
    format!(
        "schema_version: sprisk.methodology_rule/v1
id: methodology.pack.a@1.0.0
name: Test rule
stage: models
decides: modeling.a
status: active
selection: shortlist
applies_to: [sprisk.ml.linear_model]
reads: [candidate.*.family]
provenance: {{ standard: s, citation: c, pitfall: p, corner_cases: [] }}
policy_thresholds: {{}}
alternatives: {alternatives}
verification: {{ check_id: sprisk.checks.x@1.0.0, invariant: i }}
examples: {examples}
"
    )
}

#[test]
fn a_shortlist_rule_loads_with_candidates_from_the_registry() {
    let dir = tempfile::tempdir().unwrap();
    let examples = "[{ given: { candidate.ml_dummy_baseline.family: featureless }, shortlist: [ml_dummy_baseline] }]";
    write_active(dir.path(), "a", &shortlist_yaml("[]", examples));
    RuleCatalog::load_dir(dir.path()).unwrap();
}

#[test]
fn a_shortlist_rule_has_no_alternatives_of_its_own() {
    let examples = "[{ given: {}, shortlist: [keep] }]";
    let alternatives =
        "[{ id: keep, label: Keep, description: d, rationale: r, action: { type: remove_node } }]";
    assert!(refused(&shortlist_yaml(alternatives, examples)).contains("registry"));
}

#[test]
fn a_shortlist_example_gives_a_shortlist_not_a_pick() {
    let examples = "[{ given: {}, picks: ml_dummy_baseline }]";
    assert!(refused(&shortlist_yaml("[]", examples)).contains("shortlist"));
}

#[test]
fn a_recommend_rule_needs_a_menu_and_examples_that_pick_from_it() {
    let manifest = active_yaml("methodology.pack.a@1.0.0", "cleaning.a", "sprisk.clean.scale", READS_AND_EXAMPLE)
        .replace(
            "alternatives:\n  - { id: keep, label: Keep, description: d, rationale: r, action: { type: remove_node } }\n",
            "alternatives: []\n",
        );
    assert!(refused(&manifest).contains("alternatives"));
    let manifest = active_yaml(
        "methodology.pack.a@1.0.0",
        "cleaning.a",
        "sprisk.clean.scale",
        "reads: []\nexamples: [{ given: {}, shortlist: [keep] }]\n",
    );
    assert!(refused(&manifest).contains("picks"));
}
