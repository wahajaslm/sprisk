//! The repo's packs, loaded with the registered plugins whose producers their methods need.

use std::path::{Path, PathBuf};

use sprisk_methodology::RuleCatalog;
use sprisk_registry::Registry;

pub fn repo(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

/// `from`'s files under `to`, so a test can edit a copy of a pack.
#[allow(dead_code)]
pub fn copy_dir(from: &Path, to: &Path) {
    for entry in walkdir::WalkDir::new(from) {
        let entry = entry.expect("the folder can be read");
        let target = to.join(entry.path().strip_prefix(from).expect("under the folder"));
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target).expect("a folder can be made");
        } else {
            std::fs::copy(entry.path(), &target).expect("a file can be copied");
        }
    }
}

#[allow(dead_code)]
pub fn repo_catalog() -> RuleCatalog {
    let plugins = Registry::load_dir(&repo("plugins")).expect("the plugins load");
    RuleCatalog::load_dir(&repo("methodology"), plugins.operators()).expect("the packs load")
}

/// Retired rules kept as fixtures, each an example of an old-format rule's mechanics: one that
/// replaces a step (the split), one compared on folds (missing values), one that inserts a
/// step or sets the model's settings (encoding). The old format goes with ADR-0063 slice 6.
const EXAMPLES: [(&str, &str); 3] = [
    ("data_split", "example_split_rule"),
    ("missingness", "example_missingness_rule"),
    ("categorical_encoding", "example_categorical_encoding_rule"),
];

/// The repo's rules, without its methods, and the retired example rules from the fixtures,
/// for tests of the review's mechanics.
#[allow(dead_code)]
pub fn rules_with_examples() -> RuleCatalog {
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
    for (name, fixture) in EXAMPLES {
        let example = packs.path().join("supervised/rules").join(name);
        std::fs::create_dir_all(&example).expect("a folder");
        let fixture = example_rule(fixture);
        for file in ["rule.yaml", "rule.py"] {
            std::fs::copy(fixture.join(file), example.join(file)).expect("a copy");
        }
    }
    let plugins = Registry::load_dir(&repo("plugins")).expect("the plugins load");
    RuleCatalog::load_dir(packs.path(), plugins.operators()).expect("the rules load")
}

/// The folder of a retired example rule kept in the fixtures.
#[allow(dead_code)]
pub fn example_rule(fixture: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(fixture)
}
