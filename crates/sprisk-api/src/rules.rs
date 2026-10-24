//! Runs methodology rules' Python `decide()` (ADR-0042) in one bounded process per review
//! (ADR-0059): Python starts once, not once per rule.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::json;
use sprisk_contracts::{RuleAnswer, RuleDecision, RuleObservation, RuleRequest, parse};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::codec::{FramedRead, LinesCodec};

use crate::bounded::{ProcessError, cleared_command};

const MAX_ANSWER_BYTES: usize = 8 << 20;
/// Of a session's stderr, what goes to the log; the rest is read and dropped.
const MAX_LOGGED_ERROR_BYTES: usize = 16 << 10;

/// `python -m sprisk_workers.rule`: RuleRequest lines in, one RuleAnswer line each out.
#[derive(Clone, Debug)]
pub struct RuleRunner {
    command: Vec<String>,
    /// For each decision, starting Python included.
    timeout: Duration,
    sessions: Arc<Semaphore>,
}

impl RuleRunner {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self {
            command,
            timeout,
            sessions: Arc::new(Semaphore::new(at_once)),
        }
    }

    /// A session for one review. Its process starts with the first decision and is killed
    /// when the session is dropped.
    pub fn session(&self) -> RuleSession {
        RuleSession {
            runner: self.clone(),
            live: None,
        }
    }

    fn start(&self) -> Result<Live, ProcessError> {
        let slot = self
            .sessions
            .clone()
            .try_acquire_owned()
            .map_err(|_| ProcessError::Busy)?;
        let mut child = cleared_command(&self.command)?
            .spawn()
            .map_err(|e| ProcessError::Failed(e.to_string()))?;
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            return Err(ProcessError::Failed("rule session has no stdio".into()));
        };
        tokio::spawn(log_errors(stderr));
        Ok(Live {
            stdin,
            stdout: FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_ANSWER_BYTES)),
            _child: child,
            _slot: slot,
        })
    }
}

/// One review's rule process, started on first use.
pub struct RuleSession {
    runner: RuleRunner,
    live: Option<Live>,
}

struct Live {
    stdin: ChildStdin,
    stdout: FramedRead<ChildStdout, LinesCodec>,
    // Held so the process is killed, and its slot freed, when the session ends.
    _child: Child,
    _slot: OwnedSemaphorePermit,
}

impl RuleSession {
    /// The rule's decision. A rule that refuses its observation leaves the process running for
    /// the next rule; a timeout or a broken answer kills it, and the next decision starts anew.
    pub async fn decide(
        &mut self,
        module: &Path,
        observation: &RuleObservation,
    ) -> Result<RuleDecision, ProcessError> {
        let request: RuleRequest = parse(
            &json!({
                "schema_version": "sprisk.rule_request/v1",
                "module": module.display().to_string(),
                "observation": observation,
            })
            .to_string(),
        )
        .map_err(|e| ProcessError::Failed(format!("rule request: {e}")))?;
        let line = serde_json::to_string(&request)
            .map_err(|e| ProcessError::Failed(format!("rule request: {e}")))?;
        let live = match &mut self.live {
            Some(live) => live,
            None => self.live.insert(self.runner.start()?),
        };
        let timeout = self.runner.timeout;
        let answer = match tokio::time::timeout(timeout, exchange(live, &line)).await {
            Ok(answer) => answer,
            Err(_) => Err(ProcessError::Timeout(timeout)),
        };
        match answer {
            // A rule printing a forged answer must not answer for another rule.
            Ok(RuleAnswer::Decided(decided)) if decided.decision.rule != observation.rule => {
                tracing::error!(
                    rule = observation.rule.as_str(),
                    answered = decided.decision.rule.as_str(),
                    "rule session answered for another rule"
                );
                self.live = None;
                Err(ProcessError::Failed(format!(
                    "rule {} got a decision for another rule",
                    observation.rule.as_str()
                )))
            }
            Ok(RuleAnswer::Decided(decided)) => Ok(decided.decision),
            Ok(RuleAnswer::Refused(refused)) => {
                tracing::error!(
                    rule = observation.rule.as_str(),
                    error = refused.error.as_str(),
                    "rule refused"
                );
                Err(ProcessError::Failed(format!(
                    "rule {} refused its observation",
                    observation.rule.as_str()
                )))
            }
            Err(e) => {
                tracing::error!(rule = observation.rule.as_str(), error = %e, "rule session ended");
                self.live = None;
                Err(e)
            }
        }
    }
}

async fn exchange(live: &mut Live, line: &str) -> Result<RuleAnswer, ProcessError> {
    let failed = |e: std::io::Error| ProcessError::Failed(e.to_string());
    live.stdin
        .write_all(line.as_bytes())
        .await
        .map_err(failed)?;
    live.stdin.write_all(b"\n").await.map_err(failed)?;
    live.stdin.flush().await.map_err(failed)?;
    let answer = match live.stdout.next().await {
        Some(Ok(answer)) => answer,
        Some(Err(e)) => return Err(ProcessError::Failed(format!("rule answer: {e}"))),
        None => return Err(ProcessError::Failed("the rule session exited".into())),
    };
    // The parse error may quote the answer, which can hold dataset text: it goes to the log.
    parse(&answer).map_err(|e| {
        tracing::error!(error = %e, "invalid rule answer");
        ProcessError::Failed("invalid rule answer".into())
    })
}

/// Logs the start of a session's stderr (Python's errors name local paths and may quote
/// dataset text, so they stay in the server's log) and drains the rest, so the process never
/// blocks on a full pipe.
async fn log_errors(stderr: ChildStderr) {
    let mut lines = FramedRead::new(
        stderr,
        LinesCodec::new_with_max_length(MAX_LOGGED_ERROR_BYTES),
    );
    let mut logged = 0;
    while let Some(line) = lines.next().await {
        if logged >= MAX_LOGGED_ERROR_BYTES {
            continue;
        }
        match line {
            Ok(line) => {
                logged += line.len();
                tracing::error!(stderr = %line, "rule session");
            }
            Err(e) => {
                logged = MAX_LOGGED_ERROR_BYTES;
                tracing::error!(error = %e, "rule session stderr");
            }
        }
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
                "rule":"methodology.supervised.model_baseline_selection@2.0.0","facts":{},"profile":{},"settings":{}}"#,
        )
        .unwrap()
    }

    /// A file holding a decided answer on one line, for a shell script to print.
    fn decided(dir: &Path) -> String {
        let answer: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/contract/rule_answer/valid/decided.json"
        ))
        .unwrap();
        let path = dir.join("decided.json");
        std::fs::write(&path, answer.to_string() + "\n").unwrap();
        path.display().to_string()
    }

    async fn decide(session: &mut RuleSession) -> Result<RuleDecision, ProcessError> {
        session.decide(Path::new("rule.py"), &observation()).await
    }

    #[tokio::test]
    async fn one_process_answers_every_decision_of_a_session() {
        let dir = tempfile::tempdir().unwrap();
        let starts = dir.path().join("starts");
        let script = format!(
            "echo start >> {}; while read line; do cat {}; done",
            starts.display(),
            decided(dir.path())
        );
        let mut session = runner(&script, Duration::from_secs(5)).session();
        for _ in 0..3 {
            decide(&mut session).await.unwrap();
        }
        assert_eq!(std::fs::read_to_string(&starts).unwrap(), "start\n");
    }

    #[tokio::test]
    async fn a_refusal_keeps_the_process_for_the_next_rule() {
        let dir = tempfile::tempdir().unwrap();
        let starts = dir.path().join("starts");
        let script = format!(
            "echo start >> {}; read line; echo '{{\"answer\":\"refused\",\"error\":\"no share\"}}'; \
             while read line; do cat {}; done",
            starts.display(),
            decided(dir.path())
        );
        let mut session = runner(&script, Duration::from_secs(5)).session();
        let Err(ProcessError::Failed(why)) = decide(&mut session).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("refused its observation"), "{why}");
        decide(&mut session).await.unwrap();
        assert_eq!(std::fs::read_to_string(&starts).unwrap(), "start\n");
    }

    #[tokio::test]
    async fn the_session_gets_none_of_the_server_s_own_variables() {
        let dir = tempfile::tempdir().unwrap();
        let seen = dir.path().join("env");
        let script = format!(
            "env > {}; while read line; do cat {}; done",
            seen.display(),
            decided(dir.path())
        );
        decide(&mut runner(&script, Duration::from_secs(5)).session())
            .await
            .unwrap();
        // cargo test sets CARGO_* in this process; none may reach the session.
        let env = std::fs::read_to_string(&seen).unwrap();
        assert!(env.lines().all(|l| !l.starts_with("CARGO")), "{env}");
    }

    #[tokio::test]
    async fn a_session_that_exits_is_refused_and_the_next_decision_starts_anew() {
        let dir = tempfile::tempdir().unwrap();
        let crashed = dir.path().join("crashed");
        let script = format!(
            "if [ ! -e {crashed} ]; then touch {crashed}; read line; exit 1; fi; \
             while read line; do cat {}; done",
            decided(dir.path()),
            crashed = crashed.display()
        );
        let mut session = runner(&script, Duration::from_secs(5)).session();
        let Err(ProcessError::Failed(why)) = decide(&mut session).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("exited"), "{why}");
        decide(&mut session).await.unwrap();
    }

    #[tokio::test]
    async fn a_decision_for_another_rule_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let script = format!("while read line; do cat {}; done", decided(dir.path()));
        let mut session = runner(&script, Duration::from_secs(5)).session();
        let other: RuleObservation = parse(
            r#"{"schema_version":"sprisk.rule_observation/v1",
                "rule":"methodology.pack.other@1.0.0","facts":{},"profile":{},"settings":{}}"#,
        )
        .unwrap();
        let Err(ProcessError::Failed(why)) = session.decide(Path::new("rule.py"), &other).await
        else {
            panic!("expected a refusal");
        };
        assert!(why.contains("another rule"), "{why}");
    }

    #[tokio::test]
    async fn a_session_that_prints_no_answer_is_refused() {
        let mut session = runner(
            "read line; echo '{\"not\":\"an answer\"}'",
            Duration::from_secs(5),
        )
        .session();
        let Err(ProcessError::Failed(why)) = decide(&mut session).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("invalid rule answer"), "{why}");
    }

    #[tokio::test]
    async fn a_rule_that_takes_too_long_is_stopped_and_the_next_starts_anew() {
        let dir = tempfile::tempdir().unwrap();
        let slow = dir.path().join("slow");
        // The first process hangs; the second answers.
        let script = format!(
            "if [ ! -e {slow} ]; then touch {slow}; sleep 5; fi; while read line; do cat {}; done",
            decided(dir.path()),
            slow = slow.display()
        );
        let mut session = runner(&script, Duration::from_millis(300)).session();
        let timed_out = decide(&mut session).await;
        assert!(
            matches!(timed_out, Err(ProcessError::Timeout(_))),
            "{timed_out:?}"
        );
        decide(&mut session).await.unwrap();
    }

    #[tokio::test]
    async fn sessions_beyond_the_limit_are_busy_until_one_ends() {
        let dir = tempfile::tempdir().unwrap();
        let script = format!("while read line; do cat {}; done", decided(dir.path()));
        let runner = runner(&script, Duration::from_secs(5));
        let mut first = runner.session();
        decide(&mut first).await.unwrap();
        let mut second = runner.session();
        assert!(matches!(decide(&mut second).await, Err(ProcessError::Busy)));
        drop(first);
        decide(&mut second).await.unwrap();
    }
}
