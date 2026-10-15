//! Attempt state machine (ADR-0013). The only way to change an attempt's state.

use sprisk_contracts::AttemptState::{self, *};

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("illegal attempt transition: {from} -> {to}")]
pub struct TransitionError {
    pub from: AttemptState,
    pub to: AttemptState,
}

/// Returns `to` if the move is legal, so callers can write `state = transition(state, to)?`.
pub fn transition(from: AttemptState, to: AttemptState) -> Result<AttemptState, TransitionError> {
    let allowed = match from {
        Created => matches!(to, Validated | Failed | Cancelled),
        Validated => matches!(to, Queued | CacheHit | Skipped | Cancelled),
        Queued => matches!(to, Leased | Skipped | Cancelled),
        Leased => matches!(to, Running | Failed | TimedOut | Cancelled),
        Running => matches!(to, Uploading | Failed | TimedOut | Cancelled),
        Uploading => matches!(to, Succeeded | Failed | TimedOut | Cancelled),
        Succeeded | Failed | Cancelled | TimedOut | Skipped | CacheHit => false,
    };
    if allowed {
        Ok(to)
    } else {
        Err(TransitionError { from, to })
    }
}

pub fn is_terminal(state: AttemptState) -> bool {
    matches!(
        state,
        Succeeded | Failed | Cancelled | TimedOut | Skipped | CacheHit
    )
}
