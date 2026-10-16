//! `POST /code/split` (ADR-0031): Python reads notebook cells and suggests code steps.
//!
//! One short process per request. It only parses the code (rule 2: Python reads Python); the
//! process and its time limit are the boundary for hostile input.

use std::process::Stdio;
use std::time::Duration;

use sprisk_contracts::{CodeSplit, CodeSplitRequest, parse};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

/// Most cells one request may hold; larger notebooks are split in parts.
pub const MAX_CELLS: usize = 1000;
const MAX_OUTPUT_BYTES: u64 = 8 << 20;
const MAX_ERROR_BYTES: u64 = 16 << 10;

/// The command that reads cells (e.g. `python -m sprisk_code.cells`) and how long it may take.
#[derive(Clone, Debug)]
pub struct Splitter {
    pub command: Vec<String>,
    pub timeout: Duration,
}

#[derive(Debug, thiserror::Error)]
pub enum SplitError {
    #[error("{0} cells; at most {MAX_CELLS} can be split at once")]
    TooManyCells(usize),
    #[error("reading the cells took longer than {0:?}")]
    Timeout(Duration),
    #[error("the code splitter failed: {0}")]
    Failed(String),
}

impl Splitter {
    pub async fn split(&self, request: &CodeSplitRequest) -> Result<CodeSplit, SplitError> {
        if request.cells.len() > MAX_CELLS {
            return Err(SplitError::TooManyCells(request.cells.len()));
        }
        let input = serde_json::to_vec(request).map_err(|e| SplitError::Failed(e.to_string()))?;
        // Dropping the future on timeout drops the child, which kills it (`kill_on_drop`).
        tokio::time::timeout(self.timeout, self.run(input))
            .await
            .map_err(|_| SplitError::Timeout(self.timeout))?
    }

    async fn run(&self, input: Vec<u8>) -> Result<CodeSplit, SplitError> {
        let failed = |e: std::io::Error| SplitError::Failed(e.to_string());
        let (program, args) = self
            .command
            .split_first()
            .ok_or_else(|| SplitError::Failed("no command configured".into()))?;
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(failed)?;
        let (Some(mut stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            return Err(SplitError::Failed("child has no stdio".into()));
        };
        let write = async move {
            stdin.write_all(&input).await?;
            stdin.shutdown().await
        };
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let (mut stdout, mut stderr) =
            (stdout.take(MAX_OUTPUT_BYTES), stderr.take(MAX_ERROR_BYTES));
        let (written, read_out, read_err) = tokio::join!(
            write,
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err),
        );
        let status = child.wait().await.map_err(failed)?;
        if !status.success() {
            let message = String::from_utf8_lossy(&err);
            return Err(SplitError::Failed(format!("{status}: {}", message.trim())));
        }
        written.and(read_out).and(read_err).map_err(failed)?;
        let text = String::from_utf8(out).map_err(|e| SplitError::Failed(e.to_string()))?;
        parse(&text).map_err(|e| SplitError::Failed(format!("invalid output: {e}")))
    }
}
