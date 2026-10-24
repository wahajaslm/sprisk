//! A bounded Python process that answers one JSON line per request line, kept for many
//! requests so Python starts once (ADR-0059). Rule and method sessions speak through it.

use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::codec::{FramedRead, LinesCodec};

use crate::bounded::{ProcessError, cleared_command};

const MAX_ANSWER_BYTES: usize = 8 << 20;
/// Of a session's stderr, what goes to the log; the rest is read and dropped.
const MAX_LOGGED_ERROR_BYTES: usize = 16 << 10;

#[derive(Clone, Debug)]
pub(crate) struct LineRunner {
    command: Vec<String>,
    /// For each answer, starting Python included.
    timeout: Duration,
    sessions: Arc<Semaphore>,
}

impl LineRunner {
    pub(crate) fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self {
            command,
            timeout,
            sessions: Arc::new(Semaphore::new(at_once)),
        }
    }

    /// A session whose process starts with its first request and is killed when it is dropped.
    pub(crate) fn session(&self) -> LineSession {
        LineSession {
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
            return Err(ProcessError::Failed("session has no stdio".into()));
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

pub(crate) struct LineSession {
    runner: LineRunner,
    live: Option<Live>,
}

struct Live {
    stdin: ChildStdin,
    stdout: FramedRead<ChildStdout, LinesCodec>,
    // Held so the process is killed, and its slot freed, when the session ends.
    _child: Child,
    _slot: OwnedSemaphorePermit,
}

impl LineSession {
    /// The answer line to `line`. A timeout or a broken pipe kills the process, and the next
    /// request starts a new one.
    pub(crate) async fn exchange(&mut self, line: &str) -> Result<String, ProcessError> {
        let live = match &mut self.live {
            Some(live) => live,
            None => self.live.insert(self.runner.start()?),
        };
        let timeout = self.runner.timeout;
        let answer = match tokio::time::timeout(timeout, exchange(live, line)).await {
            Ok(answer) => answer,
            Err(_) => Err(ProcessError::Timeout(timeout)),
        };
        if answer.is_err() {
            self.end();
        }
        answer
    }

    /// Kills the process, for an answer the caller cannot trust; the next request starts anew.
    pub(crate) fn end(&mut self) {
        self.live = None;
    }
}

async fn exchange(live: &mut Live, line: &str) -> Result<String, ProcessError> {
    let failed = |e: std::io::Error| ProcessError::Failed(e.to_string());
    live.stdin
        .write_all(line.as_bytes())
        .await
        .map_err(failed)?;
    live.stdin.write_all(b"\n").await.map_err(failed)?;
    live.stdin.flush().await.map_err(failed)?;
    match live.stdout.next().await {
        Some(Ok(answer)) => Ok(answer),
        Some(Err(e)) => Err(ProcessError::Failed(format!("session answer: {e}"))),
        None => Err(ProcessError::Failed("the session exited".into())),
    }
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
                tracing::error!(stderr = %line, "python session");
            }
            Err(e) => {
                logged = MAX_LOGGED_ERROR_BYTES;
                tracing::error!(error = %e, "python session stderr");
            }
        }
    }
}
