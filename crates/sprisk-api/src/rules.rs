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

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn runner(script: &str, timeout: Duration) -> RuleRunner {
        RuleRunner::new(vec!["sh".into(), "-c".into(), script.into()], timeout, 1)
    }

    fn observation() -> RuleObservation {
        parse(
            r#"{"schema_version":"sprisk.rule_observation/v1",
                "rule":"methodology.pack.a@1.0.0","facts":{},"profile":{},"settings":{}}"#,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn a_rule_that_prints_no_decision_is_refused() {
        let decided = runner(
            "cat >/dev/null; echo '{\"not\":\"a decision\"}'",
            Duration::from_secs(5),
        )
        .decide(Path::new("rule.py"), &observation())
        .await;
        let Err(ProcessError::Failed(why)) = decided else {
            panic!("expected a refusal, got {decided:?}");
        };
        assert!(why.contains("invalid rule decision"), "{why}");
    }

    #[tokio::test]
    async fn a_rule_that_takes_too_long_is_stopped() {
        let slow = runner("sleep 5", Duration::from_millis(100))
            .decide(Path::new("rule.py"), &observation())
            .await;
        assert!(matches!(slow, Err(ProcessError::Timeout(_))), "{slow:?}");
    }
}
