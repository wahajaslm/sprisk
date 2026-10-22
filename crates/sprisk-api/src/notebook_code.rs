//! `POST /operators/{id}/notebook_code` (ADR-0055): Python writes a ready-made step as plain
//! Python for a notebook cell. One bounded process per request, like the rule runner.

use std::time::Duration;

use sprisk_contracts::{
    NotebookCode, NotebookCodeRequest, NotebookSettings, NotebookSettingsRequest, parse,
};

use crate::bounded::{BoundedProcess, ProcessError};

/// `python -m sprisk_workers.notebook_code <module:function>`: a NotebookCodeRequest in, a
/// NotebookCode out. The function comes from the step's manifest, never from the request.
#[derive(Clone, Debug)]
pub struct CodeWriter(BoundedProcess);

impl CodeWriter {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(BoundedProcess::new(
            "plain code writer",
            command,
            timeout,
            at_once,
        ))
    }

    pub async fn write(
        &self,
        writer: &str,
        request: &NotebookCodeRequest,
    ) -> Result<NotebookCode, ProcessError> {
        let input = serde_json::to_vec(request)
            .map_err(|e| ProcessError::Failed(format!("request: {e}")))?;
        let text = self.0.run_with(&[writer.to_owned()], input).await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid plain code: {e}")))
    }

    /// What an edited cell of the step `writer` writes is: its settings, or code (ADR-0055).
    pub async fn read(
        &self,
        writer: &str,
        request: &NotebookSettingsRequest,
    ) -> Result<NotebookSettings, ProcessError> {
        let input = serde_json::to_vec(request)
            .map_err(|e| ProcessError::Failed(format!("request: {e}")))?;
        let text = self
            .0
            .run_with(&["--read".to_owned(), writer.to_owned()], input)
            .await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid settings read: {e}")))
    }
}
