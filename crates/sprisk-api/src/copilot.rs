//! `POST /copilot/chat` and `POST /copilot/ledger` (ADR-0066): Python asks the local model, one
//! bounded process per request. Rust holds the policy: the model's address is set at start-up,
//! never by a request, and must be on this machine (external AI stays off, rule 6).

use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;
use sprisk_contracts::{
    CopilotChatReply, CopilotChatRequest, CopilotLedgerDraft, CopilotLedgerRequest, parse,
};
use url::{Host, Url};

use crate::bounded::{BoundedProcess, ProcessError};

/// `python -m sprisk_workers.copilot <chat|ledger> <ollama_url> <model>`.
#[derive(Clone, Debug)]
pub struct Copilot {
    process: BoundedProcess,
    ollama: String,
    model: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CopilotConfigError {
    #[error("{0} is not a URL: {1}")]
    NotAUrl(String, url::ParseError),
    #[error("{0} is not on this machine; external AI providers are off (ADR-0014)")]
    NotLocal(String),
}

impl Copilot {
    /// A Copilot that asks the Ollama at `ollama`, which must be a loopback http URL.
    pub fn local(
        command: Vec<String>,
        ollama: &str,
        model: &str,
        timeout: Duration,
        at_once: usize,
    ) -> Result<Self, CopilotConfigError> {
        let url = Url::parse(ollama).map_err(|e| CopilotConfigError::NotAUrl(ollama.into(), e))?;
        let local = match url.host() {
            Some(Host::Domain(name)) => name == "localhost",
            Some(Host::Ipv4(ip)) => ip.is_loopback(),
            Some(Host::Ipv6(ip)) => ip.is_loopback(),
            None => false,
        };
        if url.scheme() != "http" || !local {
            return Err(CopilotConfigError::NotLocal(ollama.into()));
        }
        Ok(Self {
            process: BoundedProcess::new("copilot", command, timeout, at_once),
            ollama: url.as_str().trim_end_matches('/').to_owned(),
            model: model.to_owned(),
        })
    }

    pub async fn chat(
        &self,
        request: &CopilotChatRequest,
    ) -> Result<CopilotChatReply, ProcessError> {
        self.ask("chat", request).await
    }

    pub async fn draft_ledger(
        &self,
        request: &CopilotLedgerRequest,
    ) -> Result<CopilotLedgerDraft, ProcessError> {
        self.ask("ledger", request).await
    }

    async fn ask<T: DeserializeOwned>(
        &self,
        call: &str,
        request: &impl Serialize,
    ) -> Result<T, ProcessError> {
        let input = serde_json::to_vec(request)
            .map_err(|e| ProcessError::Failed(format!("request: {e}")))?;
        let args = [call.to_owned(), self.ollama.clone(), self.model.clone()];
        let text = self.process.run_with(&args, input).await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid copilot answer: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(url: &str) -> Result<Copilot, CopilotConfigError> {
        Copilot::local(vec!["true".into()], url, "m", Duration::from_secs(1), 1)
    }

    #[test]
    fn only_a_model_on_this_machine_is_allowed() {
        for url in [
            "http://127.0.0.1:11434",
            "http://localhost:11434",
            "http://[::1]:11434",
        ] {
            assert!(local(url).is_ok(), "{url}");
        }
        for url in [
            "http://api.example.com",
            "https://127.0.0.1:11434",
            "http://10.0.0.5:11434",
            "http://127.0.0.1.example.com",
            "not a url",
        ] {
            assert!(local(url).is_err(), "{url}");
        }
    }
}
