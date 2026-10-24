//! One short Python process per request, with a time limit, capped output, a cap on how many
//! run at once and a cleared environment, so requests cannot pile up processes and hostile
//! input never sits in the server (the cell splitter, ADR-0031; the dataset profiler,
//! ADR-0038). It bounds the work; it is not a sandbox.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Semaphore;

const MAX_OUTPUT_BYTES: u64 = 8 << 20;
const MAX_ERROR_BYTES: u64 = 16 << 10;
/// The only variables the process inherits: it reads untrusted input, so the server's keys
/// and tokens stay out of it.
const PASSED_ENV: &[&str] = &["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"];

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
        self.run_with(&[], input).await
    }

    /// As `run`, with `args` after the configured command.
    pub async fn run_with(&self, args: &[String], input: Vec<u8>) -> Result<String, ProcessError> {
        let _slot = self.running.try_acquire().map_err(|_| ProcessError::Busy)?;
        // Dropping the future on timeout drops the child, which kills it (`kill_on_drop`).
        tokio::time::timeout(self.timeout, self.run_once(args, input))
            .await
            .map_err(|_| ProcessError::Timeout(self.timeout))?
    }

    async fn run_once(&self, extra: &[String], input: Vec<u8>) -> Result<String, ProcessError> {
        let failed = |e: std::io::Error| ProcessError::Failed(e.to_string());
        let mut child = cleared_command(&self.command)?
            .args(extra)
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

/// `command` with piped stdio, killed when dropped, and only `PASSED_ENV` from the server's
/// environment: the process reads untrusted input, so the server's keys and tokens stay out.
pub(crate) fn cleared_command(command: &[String]) -> Result<Command, ProcessError> {
    let (program, args) = command
        .split_first()
        .ok_or_else(|| ProcessError::Failed("no command configured".into()))?;
    let mut cleared = Command::new(program);
    cleared
        .args(args)
        .env_clear()
        .envs(
            PASSED_ENV
                .iter()
                .filter_map(|k| Some((k, std::env::var_os(k)?))),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(cleared)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The process reads untrusted files; the server's own environment (keys, tokens) stays out.
    #[tokio::test]
    async fn the_process_gets_only_the_few_variables_python_needs() {
        let env = BoundedProcess::new("test", vec!["env".into()], Duration::from_secs(5), 1);
        let printed = env.run(Vec::new()).await.unwrap_or_default();
        let names: Vec<&str> = printed
            .lines()
            .filter_map(|l| l.split('=').next())
            .collect();
        assert!(!names.is_empty());
        assert!(names.iter().all(|n| PASSED_ENV.contains(n)), "{names:?}");
    }
}
