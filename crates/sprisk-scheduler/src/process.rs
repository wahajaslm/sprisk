use std::process::Stdio;

use futures_util::StreamExt;
use sprisk_contracts::{WorkerId, WorkerMessage, parse};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio_util::codec::{FramedRead, LinesCodec};

use crate::worker::{Worker, WorkerError, Workers};

/// Bounds memory per message; datasets never travel in messages.
const MAX_LINE_BYTES: usize = 1 << 20;

/// Spawns `command` (e.g. `python -m sprisk_workers --plugins-root plugins`) per worker.
pub struct ProcessWorkers {
    pub command: Vec<String>,
}

pub struct ProcessWorker {
    id: WorkerId,
    // Held so the process is killed when the worker is dropped.
    _child: Child,
    stdin: ChildStdin,
    stdout: FramedRead<ChildStdout, LinesCodec>,
}

impl Workers for ProcessWorkers {
    type Worker = ProcessWorker;

    async fn spawn(&mut self) -> Result<ProcessWorker, WorkerError> {
        let (program, args) = self
            .command
            .split_first()
            .ok_or_else(|| WorkerError::Protocol("empty worker command".into()))?;
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(WorkerError::Spawn)?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            return Err(WorkerError::Protocol("worker stdio not piped".into()));
        };
        let mut stdout = FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_LINE_BYTES));
        let id = match read(&mut stdout).await? {
            WorkerMessage::Handshake(h) => h.worker_id,
            other => {
                return Err(WorkerError::Protocol(format!(
                    "expected handshake first, got {other:?}"
                )));
            }
        };
        Ok(ProcessWorker {
            id,
            _child: child,
            stdin,
            stdout,
        })
    }
}

impl Worker for ProcessWorker {
    fn id(&self) -> &WorkerId {
        &self.id
    }

    async fn send(&mut self, message: &WorkerMessage) -> Result<(), WorkerError> {
        let mut line = serde_json::to_string(message)
            .map_err(|e| WorkerError::Protocol(format!("encode: {e}")))?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn recv(&mut self) -> Result<WorkerMessage, WorkerError> {
        read(&mut self.stdout).await
    }
}

async fn read(
    stdout: &mut FramedRead<ChildStdout, LinesCodec>,
) -> Result<WorkerMessage, WorkerError> {
    let line = stdout
        .next()
        .await
        .ok_or(WorkerError::Exited)?
        .map_err(|e| WorkerError::Protocol(format!("read: {e}")))?;
    parse(&line).map_err(|e| WorkerError::Protocol(format!("invalid message: {e}")))
}
