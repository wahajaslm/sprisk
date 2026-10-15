//! Exhaustive check of the attempt state machine against ADR-0013.
#![allow(clippy::unwrap_used)]

use sprisk_contracts::AttemptState::{self, *};
use sprisk_core::attempt::{TransitionError, is_terminal, transition};

const ALL: [AttemptState; 12] = [
    Created, Validated, Queued, Leased, Running, Uploading, Succeeded, Failed, Cancelled, TimedOut,
    Skipped, CacheHit,
];

/// The spec, copied from docs/adr/0013-attempt-state-machine.md.
const ALLOWED: &[(AttemptState, AttemptState)] = &[
    (Created, Validated),
    (Created, Failed),
    (Created, Cancelled),
    (Validated, Queued),
    (Validated, CacheHit),
    (Validated, Skipped),
    (Validated, Cancelled),
    (Queued, Leased),
    (Queued, Skipped),
    (Queued, Cancelled),
    (Leased, Running),
    (Leased, Failed),
    (Leased, TimedOut),
    (Leased, Cancelled),
    (Running, Uploading),
    (Running, Failed),
    (Running, TimedOut),
    (Running, Cancelled),
    (Uploading, Succeeded),
    (Uploading, Failed),
    (Uploading, TimedOut),
    (Uploading, Cancelled),
];

#[test]
fn every_pair_matches_the_spec() {
    for from in ALL {
        for to in ALL {
            let expected_ok = ALLOWED.contains(&(from, to));
            let result = transition(from, to);
            assert_eq!(
                result.is_ok(),
                expected_ok,
                "{from:?} -> {to:?}: got {result:?}"
            );
            if let Err(e) = result {
                assert_eq!(e, TransitionError { from, to });
            }
        }
    }
}

#[test]
fn terminal_states_are_exactly_those_without_exits() {
    for state in ALL {
        let has_exit = ALLOWED.iter().any(|(from, _)| *from == state);
        assert_eq!(is_terminal(state), !has_exit, "{state:?}");
    }
}

#[test]
fn error_names_both_states() {
    let err = transition(Succeeded, Running).unwrap_err();
    assert_eq!(
        err.to_string(),
        "illegal attempt transition: succeeded -> running"
    );
}
