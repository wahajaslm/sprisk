//! What a producer measured is checked against the fields its manifest declares (ADR-0063
//! slice 3), so a method's decide() never reads a field that is missing or of another type.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use serde_json::{Value, json};
use sprisk_contracts::Operator;
use sprisk_registry::{Registry, evidence};

fn near_duplicates() -> Operator {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    let registry = Registry::load_dir(&dir).unwrap();
    registry
        .get("sprisk.profile.near_duplicates@1.0.0")
        .unwrap()
        .clone()
}

fn measured() -> Value {
    json!({ "data.near_duplicate_groups":
        { "rows": 600, "groups": 87, "rows_in_groups": 206, "largest_group": 4 } })
}

fn refused(value: &Value) -> String {
    evidence::check(&near_duplicates(), value)
        .unwrap_err()
        .to_string()
}

#[test]
fn evidence_with_every_declared_field_passes() {
    assert!(evidence::check(&near_duplicates(), &measured()).is_ok());
}

#[test]
fn a_missing_kind_is_refused() {
    assert!(refused(&json!({})).contains("did not measure data.near_duplicate_groups"));
}

#[test]
fn an_undeclared_kind_is_refused() {
    let mut value = measured();
    value["data.titles"] = json!({});
    assert!(refused(&value).contains("measured data.titles, which it does not declare"));
}

#[test]
fn a_missing_field_is_refused() {
    let mut value = measured();
    value["data.near_duplicate_groups"]
        .as_object_mut()
        .unwrap()
        .remove("groups");
    assert!(refused(&value).contains("data.near_duplicate_groups has no groups"));
}

#[test]
fn an_undeclared_field_is_refused() {
    let mut value = measured();
    value["data.near_duplicate_groups"]["share"] = json!(0.3);
    assert!(refused(&value).contains("data.near_duplicate_groups.share is not declared"));
}

#[test]
fn a_field_of_another_type_is_refused() {
    let mut value = measured();
    value["data.near_duplicate_groups"]["groups"] = json!(8.5);
    assert!(refused(&value).contains("data.near_duplicate_groups.groups is 8.5, not integer"));
}

#[test]
fn evidence_that_is_not_an_object_is_refused() {
    assert!(refused(&json!([1, 2])).contains("its evidence is not an EvidenceSet"));
}
