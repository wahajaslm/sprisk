//! Every valid fixture must round-trip unchanged; every invalid one must be rejected.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use sprisk_contracts::Artifact;

fn fixtures(entity: &str, kind: &str) -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/contract")
        .join(entity)
        .join(kind);
    let mut paths: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no fixtures in {}", dir.display());
    paths
}

fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn valid_artifacts_round_trip() {
    for path in fixtures("artifact", "valid") {
        let original = read_json(&path);
        let parsed: Artifact = serde_json::from_value(original.clone())
            .unwrap_or_else(|e| panic!("{} should parse: {e}", path.display()));
        let reserialized = serde_json::to_value(&parsed).unwrap();
        assert_eq!(
            reserialized,
            original,
            "{} changed on round-trip",
            path.display()
        );
    }
}

#[test]
fn invalid_artifacts_are_rejected() {
    for path in fixtures("artifact", "invalid") {
        let result = serde_json::from_value::<Artifact>(read_json(&path));
        assert!(result.is_err(), "{} should be rejected", path.display());
    }
}
