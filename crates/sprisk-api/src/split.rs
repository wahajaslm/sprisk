//! `POST /code/split` (ADR-0031): Python reads notebook cells and suggests code steps.
//!
//! One short process per request. It only parses the code (rule 2: Python reads Python); the
//! process and its time limit are the boundary for hostile input.

use std::time::Duration;

use sprisk_contracts::{CodeSplit, CodeSplitRequest, parse};

use crate::bounded::{BoundedProcess, ProcessError};

/// Most cells one request may hold; larger notebooks are split in parts.
pub const MAX_CELLS: usize = 1000;

/// The command that reads cells (e.g. `python -m sprisk_code.cells`), how long it may take, and
/// how many may run at once.
#[derive(Clone, Debug)]
pub struct Splitter(BoundedProcess);

#[derive(Debug, thiserror::Error)]
pub enum SplitError {
    #[error("{0} cells; at most {MAX_CELLS} can be split at once")]
    TooManyCells(usize),
    #[error("reading the cells took longer than {0:?}")]
    Timeout(Duration),
    #[error("other cells are being read; try again in a moment")]
    Busy,
    #[error("the code splitter failed: {0}")]
    Failed(String),
}

impl From<ProcessError> for SplitError {
    fn from(e: ProcessError) -> Self {
        match e {
            ProcessError::Timeout(t) => SplitError::Timeout(t),
            ProcessError::Busy => SplitError::Busy,
            ProcessError::Failed(why) => SplitError::Failed(why),
        }
    }
}

impl Splitter {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(BoundedProcess::new(
            "code splitter",
            command,
            timeout,
            at_once,
        ))
    }

    pub async fn split(&self, request: &CodeSplitRequest) -> Result<CodeSplit, SplitError> {
        if request.cells.len() > MAX_CELLS {
            return Err(SplitError::TooManyCells(request.cells.len()));
        }
        let input = serde_json::to_vec(request).map_err(|e| SplitError::Failed(e.to_string()))?;
        let text = self.0.run(input).await?;
        parse(&text).map_err(|e| SplitError::Failed(format!("invalid output: {e}")))
    }
}
