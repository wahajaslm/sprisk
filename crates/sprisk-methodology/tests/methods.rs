//! Packs load methods and concepts beside the old rules, and refuse bad ones at load
//! (ADR-0063 slice 2). The fixture is the split decision ported from the spike.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use sprisk_contracts::Operator;
use sprisk_methodology::{CatalogError, RuleCatalog};
use sprisk_registry::Registry;
use tempfile::TempDir;

mod repo;
use repo::{copy_dir, repo, repo_catalog};

/// A copy of the split-decision fixture, with a copy of the registered near-duplicates
/// producer to break one file in.
fn split_decision() -> TempDir {
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/split_decision");
    let to = tempfile::tempdir().unwrap();
    copy_dir(&from, to.path());
    let producer = fs::read_to_string(repo(PLUGIN_NEAR_DUPLICATES)).unwrap();
    write(to.path(), NEAR_DUPLICATES, &producer);
    to
}

/// Replaces `from` with `to` in one file of the copy; `from` must be there.
fn edit(root: &Path, file: &str, from: &str, to: &str) {
    let path = root.join(file);
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "{file} has no {from:?}");
    fs::write(&path, text.replacen(from, to, 1)).unwrap();
}

fn write(root: &Path, file: &str, text: &str) {
    let path = root.join(file);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// The fixture's methods, with the registered plugins; an operator in the copy's
/// `operators/` takes the place of the plugin with its id.
fn load(root: &Path) -> Result<RuleCatalog, CatalogError> {
    let plugins = Registry::load_dir(&repo("plugins")).unwrap();
    let copies = Registry::load_dir(&root.join("operators")).unwrap();
    let mut operators: BTreeMap<String, &Operator> =
        plugins.operators().map(|o| (o.id.to_string(), o)).collect();
    operators.extend(copies.operators().map(|o| (o.id.to_string(), o)));
    RuleCatalog::load_dir(&root.join("methodology"), operators.into_values())
}

fn refused(root: &Path) -> String {
    load(root).unwrap_err().to_string()
}

const SPLIT: &str = "methodology/core/methods/split_method/method.yaml";
const REPEATED: &str = "methodology/core/methods/repeated_items/method.yaml";
const NEAR_DUPLICATES: &str = "operators/near_duplicates/manifest.yaml";
const PLUGIN_NEAR_DUPLICATES: &str = "plugins/profile/operators/near_duplicates/manifest.yaml";

#[test]
fn the_split_decision_loads_in_decision_order() {
    let pack = split_decision();
    let catalog = load(pack.path()).unwrap();

    let methods: Vec<String> = catalog.methods().map(|m| m.id.to_string()).collect();
    assert_eq!(
        methods,
        [
            "methodology.core.repeated_items@1.0.0",
            "methodology.core.split_method@1.0.0"
        ]
    );
    assert_eq!(catalog.concepts().count(), 4);
}

#[test]
fn a_method_s_files_are_its_manifest_and_module_as_loaded() {
    let pack = split_decision();
    let catalog = load(pack.path()).unwrap();

    let files = catalog
        .method_files("methodology.core.split_method@1.0.0")
        .unwrap();
    let paths: Vec<&str> = files.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["method.yaml", "method.py"]);
    assert!(
        files.files[0]
            .text
            .contains("decides: evaluation.split_method")
    );
    assert!(files.files[1].text.contains("def verify_no_group_overlap"));

    // Read when the packs load: the files shown are the files that run.
    edit(
        pack.path(),
        "methodology/core/methods/split_method/method.py",
        "def decide",
        "def decide_later",
    );
    let shown = catalog
        .method_files("methodology.core.split_method@1.0.0")
        .unwrap();
    assert!(shown.files[1].text.contains("def decide(ctx"));

    assert!(catalog.method_files("methodology.core.gone@1.0.0").is_err());
}

#[test]
fn methods_load_beside_the_old_rules() {
    let pack = split_decision();
    write(
        pack.path(),
        "methodology/core/rules/a/rule.yaml",
        &draft_rule("cleaning.a"),
    );

    let catalog = load(pack.path()).unwrap();
    assert_eq!(catalog.rules().count(), 1);
    assert_eq!(catalog.methods().count(), 2);
}

#[test]
fn every_pack_in_the_repo_still_loads_with_the_registered_operators() {
    assert!(repo_catalog().rules().count() > 0);
}

#[test]
fn a_method_needing_an_unknown_concept_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "concepts: [common.target,",
        "concepts: [common.answer,",
    );
    assert!(refused(pack.path()).contains("unknown concept common.answer"));
}

#[test]
fn an_option_filling_a_param_with_an_unknown_concept_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "group_column: common.item_identity",
        "group_column: common.item_key",
    );
    assert!(refused(pack.path()).contains("unknown concept common.item_key"));
}

#[test]
fn an_option_binding_an_unknown_concept_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        REPEATED,
        "concept: common.item_identity",
        "concept: common.item_key",
    );
    assert!(refused(pack.path()).contains("unknown concept common.item_key"));
}

#[test]
fn an_option_binding_from_evidence_its_method_does_not_need_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        REPEATED,
        "evidence: data.near_duplicate_groups, column",
        "evidence: evaluation.group_overlap, column",
    );
    assert!(refused(pack.path()).contains("binds from evaluation.group_overlap"));
}

#[test]
fn an_operator_reading_an_unknown_concept_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "common.item_title",
        "common.title",
    );
    assert!(refused(pack.path()).contains("unknown concept common.title"));
}

#[test]
fn evidence_a_method_needs_with_no_producer_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        REPEATED,
        "evidence: [data.near_duplicate_groups]",
        "evidence: [data.repeated_titles]",
    );
    assert!(refused(pack.path()).contains("data.repeated_titles: no operator produces it"));
}

#[test]
fn evidence_a_verification_needs_with_no_producer_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "needs: evaluation.group_overlap",
        "needs: evaluation.item_overlap",
    );
    assert!(refused(pack.path()).contains("evaluation.item_overlap: no operator produces it"));
}

/// A second producer of the near-duplicate evidence; `default` is its produces entry's flag.
fn second_producer(root: &Path, default: &str) {
    let first = fs::read_to_string(root.join(NEAR_DUPLICATES)).unwrap();
    let second = first
        .replace("near_duplicates@1.0.0", "fuzzy_titles@1.0.0")
        .replace("    fields:", &format!("    {default}\n    fields:"));
    write(root, "operators/fuzzy_titles/manifest.yaml", &second);
}

#[test]
fn several_producers_with_one_default_load() {
    let pack = split_decision();
    second_producer(pack.path(), "default: true");
    assert!(load(pack.path()).is_ok());
}

#[test]
fn several_producers_with_no_default_are_refused() {
    let pack = split_decision();
    second_producer(pack.path(), "default: false");
    assert!(refused(pack.path()).contains("data.near_duplicate_groups: produced by sprisk.profile.fuzzy_titles@1.0.0, sprisk.profile.near_duplicates@1.0.0, and none is the default"));
}

#[test]
fn two_default_producers_are_refused() {
    let pack = split_decision();
    second_producer(pack.path(), "default: true");
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "    fields:",
        "    default: true\n    fields:",
    );
    assert!(refused(pack.path()).contains("data.near_duplicate_groups: several defaults: sprisk.profile.fuzzy_titles@1.0.0, sprisk.profile.near_duplicates@1.0.0"));
}

#[test]
fn methods_reading_each_others_decisions_in_a_cycle_are_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        REPEATED,
        "decisions: []",
        "decisions: [evaluation.split_method]",
    );
    assert!(matches!(
        load(pack.path()),
        Err(CatalogError::DecisionCycle(_))
    ));
}

#[test]
fn a_method_reading_a_decision_no_one_makes_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "decisions: [data.repeated_items]",
        "decisions: [data.repeated_rows]",
    );
    assert!(
        refused(pack.path())
            .contains("reads decision data.repeated_rows, which no method or rule makes")
    );
}

#[test]
fn a_method_reading_a_decision_only_a_draft_rule_makes_is_refused() {
    let pack = split_decision();
    write(
        pack.path(),
        "methodology/core/rules/a/rule.yaml",
        &draft_rule("data.repeated_rows"),
    );
    edit(
        pack.path(),
        SPLIT,
        "decisions: [data.repeated_items]",
        "decisions: [data.repeated_rows]",
    );
    assert!(refused(pack.path()).contains("reads decision data.repeated_rows"));
}

#[test]
fn one_method_id_in_two_folders_is_refused() {
    let pack = split_decision();
    let split = pack.path().join("methodology/core/methods/split_method");
    let copy = pack.path().join("methodology/core/methods/split_copy");
    fs::create_dir_all(&copy).unwrap();
    for file in ["method.yaml", "method.py"] {
        fs::copy(split.join(file), copy.join(file)).unwrap();
    }
    assert!(matches!(
        load(pack.path()),
        Err(CatalogError::DuplicateId { .. })
    ));
}

#[test]
fn a_method_and_a_rule_owning_the_same_decision_are_refused() {
    let pack = split_decision();
    write(
        pack.path(),
        "methodology/core/rules/a/rule.yaml",
        &draft_rule("data.repeated_items"),
    );
    assert!(matches!(
        load(pack.path()),
        Err(CatalogError::DuplicateDecision { .. })
    ));
}

#[test]
fn an_all_rows_diagnostic_reading_a_label_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "common.item_title",
        "common.target",
    );
    assert!(
        refused(pack.path())
            .contains("reads every row, so it may not read the label common.target")
    );
}

#[test]
fn an_all_rows_diagnostic_may_name_the_label_as_a_column_it_drops() {
    let pack = split_decision();
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "common.item_title",
        "common.target",
    );
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "x-sprisk-column: true,",
        "x-sprisk-column: true, x-sprisk-excluded: true,",
    );
    load(pack.path()).unwrap();
}

const GROUP_OVERLAP: &str = "operators/group_overlap/manifest.yaml";

/// The fixture with the group overlap producer reading the target instead of the item.
fn overlap_reading_the_target() -> TempDir {
    let pack = split_decision();
    let producer = fs::read_to_string(repo(
        "plugins/validation/operators/group_overlap/manifest.yaml",
    ))
    .unwrap();
    write(pack.path(), GROUP_OVERLAP, &producer);
    edit(
        pack.path(),
        GROUP_OVERLAP,
        "common.item_identity",
        "common.target",
    );
    pack
}

#[test]
fn a_producer_on_the_split_s_test_rows_reading_a_label_is_refused() {
    let pack = overlap_reading_the_target();
    assert!(
        refused(pack.path())
            .contains("reads the test rows, so it may not read the label common.target"),
        "{}",
        refused(pack.path())
    );
}

#[test]
fn a_producer_on_the_test_rows_may_name_the_label_as_a_column_it_drops() {
    let pack = overlap_reading_the_target();
    edit(
        pack.path(),
        GROUP_OVERLAP,
        "x-sprisk-column: true,",
        "x-sprisk-column: true, x-sprisk-excluded: true,",
    );
    load(pack.path()).unwrap();
}

#[test]
fn an_option_naming_an_unregistered_operator_is_refused() {
    let pack = split_decision();
    edit(pack.path(), SPLIT, "group_split@1.0.0", "group_split@9.0.0");
    assert!(refused(pack.path()).contains("sprisk.validation.group_split@9.0.0 is not registered"));
}

#[test]
fn an_option_replacing_a_role_with_an_operator_of_another_role_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "sprisk.validation.group_split@1.0.0",
        "sprisk.clean.scale@1.0.0",
    );
    assert!(refused(pack.path()).contains("sprisk.clean.scale@1.0.0 does not have the role split"));
}

#[test]
fn an_option_setting_a_param_the_operator_lacks_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "group_column: common.item_identity",
        "group: common.item_identity",
    );
    assert!(
        refused(pack.path()).contains("sprisk.validation.temporal_split@1.0.0 has no param group")
    );
}

#[test]
fn an_option_with_a_setting_the_operator_lacks_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "{ test_fraction: 0.2, seed: 42 }",
        "{ test_share: 0.2, seed: 42 }",
    );
    assert!(
        refused(pack.path())
            .contains("sprisk.validation.group_split@1.0.0 has no param test_share")
    );
}

#[test]
fn an_option_with_a_setting_its_operator_refuses_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "{ test_fraction: 0.2, seed: 42 }",
        "{ test_fraction: 1.5, seed: 42 }",
    );
    assert!(
        refused(pack.path())
            .contains("sprisk.validation.group_split@1.0.0 does not accept test_fraction 1.5")
    );
}

#[test]
fn an_operator_mapping_a_concept_to_a_param_it_lacks_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "concepts: { title_column:",
        "concepts: { title:",
    );
    assert!(
        refused(pack.path())
            .contains("maps common.item_title to title, which is not one of its params")
    );
}

#[test]
fn an_option_mapping_a_param_its_operator_already_maps_is_refused() {
    let pack = split_decision();
    let group_split = fs::read_to_string(repo(
        "plugins/validation/operators/group_split/manifest.yaml",
    ))
    .unwrap();
    let own = group_split
        .replace("group_split@1.0.0", "own_split@1.0.0")
        .replace(
            "role: split",
            "role: split\nconcepts: { group_column: common.item_identity }",
        );
    write(pack.path(), "operators/own_split/manifest.yaml", &own);
    edit(pack.path(), SPLIT, "group_split@1.0.0", "own_split@1.0.0");
    assert!(refused(pack.path()).contains("maps group_column, which its operator already maps"));
}

#[test]
fn an_option_promising_an_undeclared_verification_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        SPLIT,
        "verify: [no_group_overlap]",
        "verify: [no_group_overlap, no_leak]",
    );
    assert!(refused(pack.path()).contains("promises no_leak, which the method does not declare"));
}

#[test]
fn a_method_without_method_py_is_refused() {
    let pack = split_decision();
    fs::remove_file(
        pack.path()
            .join("methodology/core/methods/split_method/method.py"),
    )
    .unwrap();
    assert!(refused(pack.path()).contains("a method needs its method.py"));
}

#[test]
fn a_concept_defined_in_two_packs_is_refused() {
    let pack = split_decision();
    write(
        pack.path(),
        "methodology/other/concepts.yaml",
        "schema_version: sprisk.concept_set/v1\nconcepts:\n  common.target: { kind: label, description: d, binds_to: [column] }\n",
    );
    assert!(matches!(
        load(pack.path()),
        Err(CatalogError::DuplicateConcept { .. })
    ));
}

#[test]
fn an_invalid_method_manifest_is_refused_with_its_path() {
    let pack = split_decision();
    edit(pack.path(), SPLIT, "activity: Fair evaluation\n", "");
    assert!(refused(pack.path()).contains("split_method/method.yaml"));
}

fn draft_rule(decides: &str) -> String {
    format!(
        "schema_version: sprisk.methodology_rule/v1
id: methodology.core.a@1.0.0
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

#[test]
fn a_producer_with_no_evidence_output_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "{ name: evidence, kind: report }",
        "{ name: groups, kind: report }",
    );
    assert!(
        refused(pack.path()).contains("produces evidence, so it needs an output named evidence")
    );
}

#[test]
fn a_producer_with_no_attach_is_refused() {
    let pack = split_decision();
    edit(
        pack.path(),
        NEAR_DUPLICATES,
        "attach: { role: split, side: input }\n",
        "",
    );
    assert!(refused(pack.path()).contains("produces evidence, so it needs an attach"));
}

/// A copy of the text-spelling fixture: a method whose option inserts a step.
fn text_spelling() -> TempDir {
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/text_spelling");
    let to = tempfile::tempdir().unwrap();
    copy_dir(&from, to.path());
    // No operator copies: the registered plugins are the operators.
    fs::create_dir_all(to.path().join("operators")).unwrap();
    to
}

const SPELLING: &str = "methodology/core/methods/text_spelling/method.yaml";

#[test]
fn a_method_inserting_a_step_loads() {
    let pack = text_spelling();
    let catalog = load(pack.path()).unwrap();
    assert_eq!(catalog.methods().count(), 1);
}

#[test]
fn an_insert_of_an_unregistered_operator_is_refused() {
    let pack = text_spelling();
    edit(
        pack.path(),
        SPELLING,
        "sprisk.clean.clean_text@1.0.0",
        "sprisk.clean.gone@1.0.0",
    );
    assert!(
        refused(pack.path()).contains("sprisk.clean.gone@1.0.0 is not registered"),
        "{}",
        refused(pack.path())
    );
}

#[test]
fn an_insert_reading_evidence_the_method_does_not_need_is_refused() {
    let pack = text_spelling();
    edit(
        pack.path(),
        SPELLING,
        "columns: data.spelling_variants.columns",
        "columns: data.near_duplicate_groups.groups",
    );
    assert!(
        refused(pack.path())
            .contains("reads data.near_duplicate_groups, which the method does not need"),
        "{}",
        refused(pack.path())
    );
}

#[test]
fn an_insert_reading_a_field_its_producer_does_not_write_is_refused() {
    let pack = text_spelling();
    edit(
        pack.path(),
        SPELLING,
        "data.spelling_variants.columns }",
        "data.spelling_variants.colums }",
    );
    assert!(
        refused(pack.path()).contains("data.spelling_variants has no field colums"),
        "{}",
        refused(pack.path())
    );
}

#[test]
fn an_insert_setting_a_param_its_operator_lacks_is_refused() {
    let pack = text_spelling();
    edit(
        pack.path(),
        SPELLING,
        "{ lowercase: true,",
        "{ upper: true,",
    );
    assert!(
        refused(pack.path()).contains("sprisk.clean.clean_text@1.0.0 has no param upper"),
        "{}",
        refused(pack.path())
    );
}

/// The repeated-items fixture with an option that sets the model's costs from the question.
fn setting_costs(needs_statements: &str) -> TempDir {
    let pack = split_decision();
    edit(
        pack.path(),
        REPEATED,
        "  decisions: []",
        &format!("  decisions: []\n{needs_statements}"),
    );
    edit(
        pack.path(),
        REPEATED,
        "  - id: independent_rows\n",
        "  - id: independent_rows\n    action: { set: { role: model, from_statements: { costs: costs } } }\n",
    );
    pack
}

#[test]
fn an_option_setting_a_step_from_a_statement_the_method_needs_loads() {
    let pack = setting_costs("  statements: [costs]");
    load(pack.path()).unwrap();
}

#[test]
fn an_option_setting_from_a_statement_the_method_does_not_need_is_refused() {
    let pack = setting_costs("");
    assert!(
        refused(pack.path()).contains("sets costs from costs, which the method does not need"),
        "{}",
        refused(pack.path())
    );
}

#[test]
fn an_option_setting_a_param_some_operator_of_the_role_lacks_is_refused() {
    let pack = setting_costs("  statements: [costs]");
    edit(
        pack.path(),
        REPEATED,
        "from_statements: { costs: costs }",
        "from_statements: { price: costs }",
    );
    assert!(
        refused(pack.path()).contains("has no param price"),
        "{}",
        refused(pack.path())
    );
}
