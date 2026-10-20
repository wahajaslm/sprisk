//! Runs one methodology rule's Python `decide()` (ADR-0042) as a bounded process.

use std::path::Path;
use std::time::Duration;

use sprisk_contracts::{RuleDecision, RuleObservation, parse};

use crate::bounded::{BoundedProcess, ProcessError};

/// `python -m sprisk_workers.rule <rule.py>`: a RuleObservation in, a RuleDecision out.
#[derive(Clone, Debug)]
pub struct RuleRunner(BoundedProcess);

impl RuleRunner {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(BoundedProcess::new(
            "methodology rule",
            command,
            timeout,
            at_once,
        ))
    }

    pub async fn decide(
        &self,
        module: &Path,
        observation: &RuleObservation,
    ) -> Result<RuleDecision, ProcessError> {
        let input = serde_json::to_vec(observation)
            .map_err(|e| ProcessError::Failed(format!("observation: {e}")))?;
        let text = self
            .0
            .run_with(&[module.display().to_string()], input)
            .await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid rule decision: {e}")))
    }
}
