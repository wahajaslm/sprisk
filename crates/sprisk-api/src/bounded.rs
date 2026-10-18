//! One short Python process per request, with a time limit, capped output and a cap on how
//! many run at once, so requests cannot pile up processes. The process is the boundary for
//! hostile input (the cell splitter, ADR-0031; the dataset profiler, ADR-0038).

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Semaphore;

const MAX_OUTPUT_BYTES: u64 = 8 << 20;
const MAX_ERROR_BYTES: u64 = 16 << 10;

#[derive(Clone, Debug)]
pub struct BoundedProcess {
    /// What it does, for the log: "code splitter".
    name: &'static str,
    command: Vec<String>,
    timeout: Duration,
    running: Arc<Semaphore>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("took longer than {0:?}")]
    Timeout(Duration),
    #[error("busy with other requests; try again in a moment")]
    Busy,
    #[error("failed: {0}")]
    Failed(String),
}

impl BoundedProcess {
    pub fn new(
        name: &'static str,
        command: Vec<String>,
        timeout: Duration,
        at_once: usize,
    ) -> Self {
        Self {
            name,
            command,
            timeout,
            running: Arc::new(Semaphore::new(at_once)),
        }
    }

    /// Writes `input` to the process and returns what it printed.
    pub async fn run(&self, input: Vec<u8>) -> Result<String, ProcessError> {
        let _slot = self.running.try_acquire().map_err(|_| ProcessError::Busy)?;
        // Dropping the future on timeout drops the child, which kills it (`kill_on_drop`).
        tokio::time::timeout(self.timeout, self.run_once(input))
            .await
            .map_err(|_| ProcessError::Timeout(self.timeout))?
    }

    async fn run_once(&self, input: Vec<u8>) -> Result<String, ProcessError> {
        let failed = |e: std::io::Error| ProcessError::Failed(e.to_string());
        let (program, args) = self
            .command
            .split_first()
            .ok_or_else(|| ProcessError::Failed("no command configured".into()))?;
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
            return Err(ProcessError::Failed("child has no stdio".into()));
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
            // Python's error names local paths; it goes to the log, not to the client.
            let message = String::from_utf8_lossy(&err);
            tracing::error!(%status, stderr = %message.trim(), "{} failed", self.name);
            return Err(ProcessError::Failed(status.to_string()));
        }
        written.and(read_out).and(read_err).map_err(failed)?;
        String::from_utf8(out).map_err(|e| ProcessError::Failed(e.to_string()))
    }
}
