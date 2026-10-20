#![allow(clippy::unwrap_used)]

use sprisk_contracts::{PortRef, parse};

#[test]
fn a_port_ref_splits_into_its_step_and_port() {
    let port: PortRef = parse("\"scale.train\"").unwrap();
    assert_eq!(port.step_and_port(), ("scale", "train"));
}
