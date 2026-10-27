//! Runs methods' Python `decide(ctx)` and `verify_<name>()` (ADR-0063) in one bounded process
//! per walk round.

use std::time::Duration;

use sprisk_contracts::{
    MethodAnswer, MethodDecided, MethodRefused, MethodRequest, MethodShortlisted, MethodVerified,
    VerificationRequest, parse,
};

use crate::bounded::ProcessError;
use crate::line_session::{LineRunner, LineSession};

/// `python -m sprisk_workers.method`: MethodRequest and VerificationRequest lines in, one
/// MethodAnswer line each out.
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

/// What a method's decide() answered: one option, or, for a compared method, the options the
/// engine compares (ADR-0063 D3).
#[derive(Debug)]
pub enum Decision {
    Decided(MethodDecided),
    Shortlisted(MethodShortlisted),
}

impl MethodSession {
    /// What the method's decide() returned. A method that refuses leaves the process running
    /// for the next one; a timeout or a broken answer kills it.
    pub async fn decide(&mut self, request: &MethodRequest) -> Result<Decision, ProcessError> {
        let method = request.method.as_str();
        match self.exchange(method, request).await? {
            // A method printing a forged answer must not answer for another method.
            MethodAnswer::Decided(decided) if decided.method == request.method => {
                Ok(Decision::Decided(decided))
            }
            MethodAnswer::Decided(decided) => {
                self.forged(method, "another method", decided.method.as_str())
            }
            MethodAnswer::Shortlisted(listed) if listed.method != request.method => {
                self.forged(method, "another method", listed.method.as_str())
            }
            MethodAnswer::Shortlisted(listed) => {
                // The schema asks for two; the generated type does not hold it to that.
                let distinct: std::collections::BTreeSet<&str> =
                    listed.shortlist.iter().map(|o| o.as_str()).collect();
                if distinct.len() < 2 || distinct.len() != listed.shortlist.len() {
                    return Err(ProcessError::Failed(format!(
                        "method {method} shortlisted fewer than two distinct options: a comparison needs at least two, each once"
                    )));
                }
                if let Some(unknown) = listed
                    .shortlist
                    .iter()
                    .find(|o| !request.options.contains(o))
                {
                    return Err(ProcessError::Failed(format!(
                        "method {method} shortlisted {}, which it has no option for",
                        unknown.as_str()
                    )));
                }
                Ok(Decision::Shortlisted(listed))
            }
            MethodAnswer::Verified(verified) => {
                self.forged(method, "a verification", verified.verification.as_str())
            }
            MethodAnswer::Refused(refused) => Err(refusal(method, &refused)),
        }
    }

    /// What the method's verify_<name>() found, the same way.
    pub async fn verify(
        &mut self,
        request: &VerificationRequest,
    ) -> Result<MethodVerified, ProcessError> {
        let method = request.method.as_str();
        match self.exchange(method, request).await? {
            MethodAnswer::Verified(verified)
                if verified.method == request.method
                    && verified.verification == request.verification =>
            {
                Ok(verified)
            }
            MethodAnswer::Verified(verified) => self.forged(
                method,
                "another verification",
                verified.verification.as_str(),
            ),
            MethodAnswer::Decided(decided) => {
                self.forged(method, "a decision", decided.option.as_str())
            }
            MethodAnswer::Shortlisted(listed) => {
                self.forged(method, "a shortlist", listed.method.as_str())
            }
            MethodAnswer::Refused(refused) => Err(refusal(method, &refused)),
        }
    }

    /// Sends one request line and parses its answer. A timeout or a broken answer kills the
    /// process.
    async fn exchange(
        &mut self,
        method: &str,
        request: &impl serde::Serialize,
    ) -> Result<MethodAnswer, ProcessError> {
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
            Ok(answer) => Ok(answer),
            Err(e) => {
                tracing::error!(method, error = %e, "method session ended");
                self.0.end();
                Err(e)
            }
        }
    }

    /// An answer that does not answer the request: the session is ended, as it may be forged.
    fn forged<T>(&mut self, method: &str, what: &str, answered: &str) -> Result<T, ProcessError> {
        tracing::error!(method, answered, "method session answered {what}");
        self.0.end();
        Err(ProcessError::Failed(format!(
            "method {method} got an answer for {what}"
        )))
    }
}

/// A method's own refusal: logged, since it may name local paths, and the process kept.
fn refusal(method: &str, refused: &MethodRefused) -> ProcessError {
    tracing::error!(method, error = refused.error.as_str(), "method refused");
    ProcessError::Failed(format!("method {method} refused its request"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::path::Path;

    use sprisk_contracts::VerificationOutcome;

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
        let Decision::Decided(decided) = session.decide(&request()).await.unwrap() else {
            panic!("expected a decision");
        };
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

    /// The request a compared method gets: the model shortlist, with its three models.
    fn shortlist_request() -> MethodRequest {
        let mut request = request();
        request.method = parse("\"methodology.supervised.model_shortlist@1.0.0\"").unwrap();
        request.options = ["dummy_baseline", "linear_model", "random_forest"]
            .iter()
            .map(|o| parse(&format!("\"{o}\"")).unwrap())
            .collect();
        request
    }

    /// A shortlisted answer line with `shortlist`, for a shell script to print.
    fn shortlisted_file(dir: &Path, shortlist: &[&str]) -> String {
        let fixture = answer_file(dir, "shortlisted.json");
        let mut answer: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&fixture).unwrap()).unwrap();
        answer["shortlist"] = serde_json::json!(shortlist);
        std::fs::write(&fixture, answer.to_string() + "\n").unwrap();
        fixture
    }

    #[tokio::test]
    async fn a_compared_method_s_shortlist_comes_back() {
        let dir = tempfile::tempdir().unwrap();
        let line = shortlisted_file(dir.path(), &["dummy_baseline", "linear_model"]);
        let mut session = runner(&format!("while read line; do cat {line}; done")).session();
        let Decision::Shortlisted(shortlisted) =
            session.decide(&shortlist_request()).await.unwrap()
        else {
            panic!("expected a shortlist");
        };
        let ids: Vec<&str> = shortlisted.shortlist.iter().map(|o| o.as_str()).collect();
        assert_eq!(ids, ["dummy_baseline", "linear_model"]);
    }

    #[tokio::test]
    async fn a_shortlist_of_one_option_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let line = shortlisted_file(dir.path(), &["linear_model"]);
        let mut session = runner(&format!("while read line; do cat {line}; done")).session();
        let Err(ProcessError::Failed(why)) = session.decide(&shortlist_request()).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("at least two"), "{why}");
    }

    #[tokio::test]
    async fn a_shortlist_repeating_an_option_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let line = shortlisted_file(dir.path(), &["linear_model", "linear_model"]);
        let mut session = runner(&format!("while read line; do cat {line}; done")).session();
        let Err(ProcessError::Failed(why)) = session.decide(&shortlist_request()).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("each once"), "{why}");
    }

    #[tokio::test]
    async fn a_shortlist_naming_an_option_the_method_lacks_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let line = shortlisted_file(dir.path(), &["dummy_baseline", "gradient_boosting"]);
        let mut session = runner(&format!("while read line; do cat {line}; done")).session();
        let Err(ProcessError::Failed(why)) = session.decide(&shortlist_request()).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("gradient_boosting"), "{why}");
    }

    fn verification() -> VerificationRequest {
        parse(include_str!(
            "../../../tests/contract/verification_request/valid/no-group-overlap.json"
        ))
        .unwrap()
    }

    #[tokio::test]
    async fn a_promise_s_result_comes_back_with_its_detail() {
        let dir = tempfile::tempdir().unwrap();
        let pass = answer_file(dir.path(), "verified-pass.json");
        let mut session = runner(&format!("while read line; do cat {pass}; done")).session();
        let verified = session.verify(&verification()).await.unwrap();
        assert_eq!(verified.result, VerificationOutcome::Pass);
        assert!(verified.detail.contains("No item"), "{:?}", verified.detail);
    }

    #[tokio::test]
    async fn a_decision_answer_to_a_verification_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let ask = answer_file(dir.path(), "ask.json");
        let mut session = runner(&format!("while read line; do cat {ask}; done")).session();
        let Err(ProcessError::Failed(why)) = session.verify(&verification()).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("a decision"), "{why}");
    }

    #[tokio::test]
    async fn a_result_for_another_verification_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let fail = answer_file(dir.path(), "verified-fail.json");
        let mut session = runner(&format!("while read line; do cat {fail}; done")).session();
        let Err(ProcessError::Failed(why)) = session.verify(&verification()).await else {
            panic!("expected a refusal");
        };
        assert!(why.contains("another verification"), "{why}");
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
