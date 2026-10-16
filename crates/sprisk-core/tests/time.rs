#![allow(clippy::unwrap_used, clippy::expect_used)]

use sprisk_contracts::Timestamp;

#[test]
fn now_is_a_contract_timestamp() {
    let now = sprisk_core::time::now();
    let parsed: Result<Timestamp, _> = now.parse();
    assert!(parsed.is_ok(), "{now}");
}

#[test]
fn format_drops_sub_seconds_and_uses_z() {
    let at: jiff::Timestamp = "2026-10-16T10:00:00.987Z".parse().unwrap();
    assert_eq!(sprisk_core::time::format(at), "2026-10-16T10:00:00Z");
}
