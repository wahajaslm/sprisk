//! The repo's packs, loaded with the registered plugins whose producers their methods need.

use std::path::{Path, PathBuf};

use sprisk_methodology::RuleCatalog;
use sprisk_registry::Registry;

pub fn repo(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

pub fn repo_catalog() -> RuleCatalog {
    let plugins = Registry::load_dir(&repo("plugins")).expect("the plugins load");
    RuleCatalog::load_dir(&repo("methodology"), plugins.operators()).expect("the packs load")
}
