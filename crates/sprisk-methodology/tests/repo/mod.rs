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
