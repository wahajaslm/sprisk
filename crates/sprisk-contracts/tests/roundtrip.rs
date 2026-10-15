//! Every valid fixture must round-trip unchanged; every invalid one must be rejected.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;
use sprisk_contracts::{
    Artifact, Attempt, MethodologyCheck, Operator, PipelineVersion, QuestionVersion, Run,
    WorkerMessage, parse,
};

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

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn check<T: Serialize + DeserializeOwned>(entity: &str) {
    for path in fixtures(entity, "valid") {
        let text = read(&path);
        let original: serde_json::Value = serde_json::from_str(&text).unwrap();
        let parsed: T =
            parse(&text).unwrap_or_else(|e| panic!("{} should parse: {e}", path.display()));
        let reserialized = serde_json::to_value(&parsed).unwrap();
        assert_eq!(
            reserialized,
            original,
            "{} changed on round-trip",
            path.display()
        );
    }
    for path in fixtures(entity, "invalid") {
        let result = parse::<T>(&read(&path));
        assert!(result.is_err(), "{} should be rejected", path.display());
    }
}

const ENTITIES: &[&str] = &[
    "artifact",
    "attempt",
    "methodology_check",
    "operator",
    "pipeline_version",
    "question_version",
    "run",
    "worker_message",
];

#[test]
fn every_fixture_dir_has_an_entity() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/contract");
    let mut dirs: Vec<String> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.is_dir())
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    dirs.sort();
    assert_eq!(
        dirs, ENTITIES,
        "add a #[test] and an ENTITIES entry per fixture dir"
    );
}

#[test]
fn artifact() {
    check::<Artifact>("artifact");
}

#[test]
fn operator() {
    check::<Operator>("operator");
}

#[test]
fn pipeline_version() {
    check::<PipelineVersion>("pipeline_version");
}

#[test]
fn run() {
    check::<Run>("run");
}

#[test]
fn attempt() {
    check::<Attempt>("attempt");
}

#[test]
fn worker_message() {
    check::<WorkerMessage>("worker_message");
}

#[test]
fn question_version() {
    check::<QuestionVersion>("question_version");
}

#[test]
fn methodology_check() {
    check::<MethodologyCheck>("methodology_check");
}
