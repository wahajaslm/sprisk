//! The repo's packs, loaded with the registered plugins whose producers their methods need.

use std::path::{Path, PathBuf};

use sprisk_methodology::RuleCatalog;
use sprisk_registry::Registry;

pub fn repo(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

#[allow(dead_code)]
pub fn repo_catalog() -> RuleCatalog {
    let plugins = Registry::load_dir(&repo("plugins")).expect("the plugins load");
    RuleCatalog::load_dir(&repo("methodology"), plugins.operators()).expect("the packs load")
}

/// The repo's rules, without its methods, and the retired split rule from the fixtures: an
/// example of a rule that replaces a step, for tests of the review's mechanics.
#[allow(dead_code)]
pub fn rules_with_example_split() -> RuleCatalog {
    let packs = tempfile::tempdir().expect("a temp dir");
    for entry in walkdir::WalkDir::new(repo("methodology")) {
        let entry = entry.expect("the packs can be read");
        let path = entry.path();
        let in_rules = path.components().any(|c| c.as_os_str() == "rules");
        let name = entry.file_name();
        if !entry.file_type().is_file()
            || !(name == "concepts.yaml"
                || (in_rules && (name == "rule.yaml" || name == "rule.py")))
        {
            continue;
        }
        let to = packs.path().join(
            path.strip_prefix(repo("methodology"))
                .expect("under the packs"),
        );
        std::fs::create_dir_all(to.parent().expect("a parent")).expect("a folder");
        std::fs::copy(path, to).expect("a copy");
    }
    let example = packs.path().join("supervised/rules/data_split");
    std::fs::create_dir_all(&example).expect("a folder");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/example_split_rule");
    for file in ["rule.yaml", "rule.py"] {
        std::fs::copy(fixture.join(file), example.join(file)).expect("a copy");
    }
    let plugins = Registry::load_dir(&repo("plugins")).expect("the plugins load");
    RuleCatalog::load_dir(packs.path(), plugins.operators()).expect("the rules load")
}
