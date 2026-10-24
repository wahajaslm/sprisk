//! Runs methods' Python `decide(ctx)` (ADR-0063) in one bounded process per walk round.

use std::time::Duration;

use sprisk_contracts::{MethodAnswer, MethodDecided, MethodRequest, parse};

use crate::bounded::ProcessError;
use crate::line_session::{LineRunner, LineSession};

/// `python -m sprisk_workers.method`: MethodRequest lines in, one MethodAnswer line each out.
#[derive(Clone, Debug)]
pub struct MethodRunner(LineRunner);

impl MethodRunner {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(LineRunner::new(command, timeout, at_once))
    }

    pub fn session(&self) -> MethodSession {
        MethodSession(self.0.session())
    }
}

pub struct MethodSession(LineSession);

impl MethodSession {
    /// What the method's decide() returned. A method that refuses leaves the process running
    /// for the next one; a timeout or a broken answer kills it.
    pub async fn decide(&mut self, request: &MethodRequest) -> Result<MethodDecided, ProcessError> {
        let method = request.method.as_str();
        let line = serde_json::to_string(request)
            .map_err(|e| ProcessError::Failed(format!("method request: {e}")))?;
        let answer = self.0.exchange(&line).await.and_then(|answer| {
            // The parse error may quote the answer, which can hold dataset text: it goes to the log.
            parse(&answer).map_err(|e| {
                tracing::error!(error = %e, "invalid method answer");
                ProcessError::Failed("invalid method answer".into())
            })
        });
        match answer {
            // A method printing a forged answer must not answer for another method.
            Ok(MethodAnswer::Decided(decided)) if decided.method != request.method => {
                tracing::error!(
                    method,
                    answered = decided.method.as_str(),
                    "method session answered for another method"
                );
                self.0.end();
                Err(ProcessError::Failed(format!(
                    "method {method} got an answer for another method"
                )))
            }
            Ok(MethodAnswer::Decided(decided)) => Ok(decided),
            Ok(MethodAnswer::Refused(refused)) => {
                tracing::error!(method, error = refused.error.as_str(), "method refused");
                Err(ProcessError::Failed(format!(
                    "method {method} refused its request"
                )))
            }
            Err(e) => {
                tracing::error!(method, error = %e, "method session ended");
                self.0.end();
                Err(e)
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::path::Path;

    use super::*;

    fn runner(script: &str) -> MethodRunner {
        MethodRunner::new(
            vec!["sh".into(), "-c".into(), script.into()],
            Duration::from_secs(5),
            1,
        )
    }

    fn request() -> MethodRequest {
        parse(include_str!(
            "../../../tests/contract/method_request/valid/repeated-items.json"
        ))
        .unwrap()
    }

    /// A file holding a contract fixture answer on one line, for a shell script to print.
    fn answer_file(dir: &Path, fixture: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/contract/method_answer/valid")
            .join(fixture);
        let answer: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let line = dir.join(fixture);
        std::fs::write(&line, answer.to_string() + "\n").unwrap();
        line.display().to_string()
    }

    #[tokio::test]
    async fn a_method_s_ask_comes_back_with_its_option_and_question() {
        let dir = tempfile::tempdir().unwrap();
        let ask = answer_file(dir.path(), "ask.json");
        let mut session = runner(&format!("while read line; do cat {ask}; done")).session();
        let decided = session.decide(&request()).await.unwrap();
        assert_eq!(decided.option.as_str(), "group_by_title");
        assert!(decided.reason.contains("same item"), "{:?}", decided.reason);
    }

    #[tokio::test]
    async fn a_refusal_keeps_the_process_for_the_next_method() {
        let dir = tempfile::tempdir().unwrap();
        let (refused, ask) = (
            answer_file(dir.path(), "refused.json"),
            answer_file(dir.path(), "ask.json"),
        );
        let starts = dir.path().join("starts");
        let script = format!(
            "echo start >> {}; read line; cat {refused}; while read line; do cat {ask}; done",
            starts.display()
        );
        let mut session = runner(&script).session();
        let Err(ProcessError::Failed(why)) = session.decide(&request()).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("refused its request"), "{why}");
        session.decide(&request()).await.unwrap();
        assert_eq!(std::fs::read_to_string(&starts).unwrap(), "start\n");
    }

    #[tokio::test]
    async fn an_answer_for_another_method_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let ask = answer_file(dir.path(), "ask.json");
        let mut session = runner(&format!("while read line; do cat {ask}; done")).session();
        let mut other = request();
        other.method = parse("\"methodology.pack.other@1.0.0\"").unwrap();
        let Err(ProcessError::Failed(why)) = session.decide(&other).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("another method"), "{why}");
    }

    #[tokio::test]
    async fn a_session_that_prints_no_answer_is_refused() {
        let mut session = runner("read line; echo '{\"not\":\"an answer\"}'").session();
        let Err(ProcessError::Failed(why)) = session.decide(&request()).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("invalid method answer"), "{why}");
    }
}
