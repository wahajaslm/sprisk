//! Session kernels (ADR-0036): one Python session host per notebook, started on first use.
//!
//! The host (`python -m sprisk_code.session`) holds the live kernel and enforces the per-cell
//! time limit and memory cap. Requests to one kernel run one at a time; an interrupt goes
//! straight through. Results are scratch: they are returned, never stored as artifacts.
//!
//! Kernels live in this process, so a second API replica would not see them. That is the known
//! cost in ADR-0036 until kernel hosts are leased like workers.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, PoisonError};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use sprisk_contracts::{
    NotebookExecution, NotebookId, NotebookKernelRequest, NotebookVariables, parse,
};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio_util::codec::{FramedRead, LinesCodec};

/// A cell's display is capped in Python (12 figures of at most 2 MB, 100 items).
const MAX_LINE_BYTES: usize = 32 << 20;
/// Beyond the cell's own limit: starting the kernel, and restarting it after a stuck interrupt.
const MARGIN: Duration = Duration::from_secs(120);
const VARIABLES_WAIT: Duration = Duration::from_secs(30);
const SHUTDOWN_WAIT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug)]
pub struct KernelLimits {
    pub cell_seconds: u64,
    pub memory_mb: u64,
    /// A kernel unused this long is shut down by `shut_idle`.
    pub idle: Duration,
    /// Most kernels alive at once.
    pub at_once: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("{0} notebooks already have a running kernel; restart one to free it")]
    TooMany(usize),
    #[error("could not start a kernel: {0}")]
    Start(String),
    #[error(
        "the kernel for notebook {notebook} stopped answering ({why}); it was shut down and its variables are gone"
    )]
    Stopped { notebook: String, why: String },
    #[error("invalid kernel request: {0}")]
    Request(String),
}

/// The command that starts a session host, where it runs, its limits, and the live kernels.
#[derive(Clone)]
pub struct Kernels {
    command: Vec<String>,
    cwd: PathBuf,
    limits: KernelLimits,
    live: Arc<Mutex<HashMap<String, Arc<Kernel>>>>,
}

struct Kernel {
    stdin: Mutex<ChildStdin>,
    // Held for a whole request, so one kernel answers one request at a time.
    stdout: Mutex<FramedRead<ChildStdout, LinesCodec>>,
    // Held so the host is killed when the kernel is dropped; ipykernel exits with its parent.
    child: Mutex<Child>,
    last_used: std::sync::Mutex<Instant>,
}

impl Kernel {
    async fn send(&self, line: &str) -> std::io::Result<()> {
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await
    }

    // A poisoned clock still holds a valid time; nothing else is guarded by it.
    fn touch(&self) {
        *self
            .last_used
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }

    fn idle_for(&self) -> Duration {
        self.last_used
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .elapsed()
    }

    /// Ask the host to shut its kernel down, then wait for it; it is killed if it does not stop.
    async fn close(&self, notebook: &str) {
        let shutdown = kernel_request(serde_json::json!({"op": "shutdown"}));
        let sent = match shutdown {
            Ok(line) => self.send(&line).await,
            Err(e) => Err(std::io::Error::other(e.to_string())),
        };
        if let Err(e) = sent {
            tracing::warn!(notebook, error = %e, "kernel host gone before shutdown");
            return;
        }
        let mut child = self.child.lock().await;
        if tokio::time::timeout(SHUTDOWN_WAIT, child.wait())
            .await
            .is_err()
        {
            tracing::warn!(notebook, "kernel host did not stop; killing it");
            if let Err(e) = child.kill().await {
                tracing::error!(notebook, error = %e, "could not kill kernel host");
            }
        }
    }
}

impl Kernels {
    pub fn new(command: Vec<String>, cwd: PathBuf, limits: KernelLimits) -> Self {
        Self {
            command,
            cwd,
            limits,
            live: Arc::default(),
        }
    }

    /// Run `code` in the notebook's kernel, starting one if it has none.
    pub async fn execute(
        &self,
        notebook: &NotebookId,
        code: &str,
    ) -> Result<NotebookExecution, KernelError> {
        let request = kernel_request(serde_json::json!({"op": "execute", "code": code}))?;
        let kernel = self.kernel(notebook).await?;
        let wait = Duration::from_secs(self.limits.cell_seconds) + MARGIN;
        let line = self.request(notebook, &kernel, &request, wait).await?;
        self.answer(notebook, &kernel, &line).await
    }

    /// Which of `names` the notebook's kernel holds. A notebook with no kernel holds none, and
    /// asking does not start one.
    pub async fn variables(
        &self,
        notebook: &NotebookId,
        names: &[String],
    ) -> Result<NotebookVariables, KernelError> {
        let request = kernel_request(serde_json::json!({"op": "variables", "names": names}))?;
        let running = self.live.lock().await.get(notebook.as_str()).cloned();
        let Some(kernel) = running else {
            let none: Vec<_> = names
                .iter()
                .map(|n| serde_json::json!({"name": n, "defined": false, "table": false}))
                .collect();
            let doc = serde_json::json!({ "variables": none }).to_string();
            return parse(&doc).map_err(|e| KernelError::Request(e.to_string()));
        };
        let line = self
            .request(notebook, &kernel, &request, VARIABLES_WAIT)
            .await?;
        self.answer(notebook, &kernel, &line).await
    }

    /// Stop the cell running now, if any. Not queued behind it.
    pub async fn interrupt(&self, notebook: &NotebookId) -> Result<(), KernelError> {
        let running = self.live.lock().await.get(notebook.as_str()).cloned();
        let Some(kernel) = running else {
            return Ok(());
        };
        let request = kernel_request(serde_json::json!({"op": "interrupt"}))?;
        if let Err(e) = kernel.send(&request).await {
            self.stop_failed(notebook, &kernel).await;
            return Err(stopped(notebook, e));
        }
        Ok(())
    }

    /// Shut the notebook's kernel down; the next execute starts a fresh one.
    pub async fn restart(&self, notebook: &NotebookId) {
        self.stop(notebook.as_str()).await;
    }

    /// Shut down kernels unused for longer than the idle limit. A busy kernel is kept.
    pub async fn shut_idle(&self) {
        let idle: Vec<(String, Arc<Kernel>)> = {
            let mut live = self.live.lock().await;
            let names: Vec<String> = live
                .iter()
                .filter(|(_, k)| k.idle_for() >= self.limits.idle && k.stdout.try_lock().is_ok())
                .map(|(name, _)| name.clone())
                .collect();
            names
                .into_iter()
                .filter_map(|name| live.remove(&name).map(|k| (name, k)))
                .collect()
        };
        for (notebook, kernel) in idle {
            tracing::info!(notebook, "shutting down idle kernel");
            kernel.close(&notebook).await;
        }
    }

    async fn kernel(&self, notebook: &NotebookId) -> Result<Arc<Kernel>, KernelError> {
        let mut live = self.live.lock().await;
        if let Some(kernel) = live.get(notebook.as_str()) {
            return Ok(kernel.clone());
        }
        if live.len() >= self.limits.at_once {
            return Err(KernelError::TooMany(live.len()));
        }
        let kernel = Arc::new(self.start()?);
        live.insert(notebook.as_str().to_owned(), kernel.clone());
        Ok(kernel)
    }

    fn start(&self) -> Result<Kernel, KernelError> {
        let (program, args) = self
            .command
            .split_first()
            .ok_or_else(|| KernelError::Start("no command configured".into()))?;
        let mut child = Command::new(program)
            .args(args)
            .arg("--cell-seconds")
            .arg(self.limits.cell_seconds.to_string())
            .arg("--memory-mb")
            .arg(self.limits.memory_mb.to_string())
            .current_dir(&self.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| KernelError::Start(e.to_string()))?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            return Err(KernelError::Start("kernel host has no stdio".into()));
        };
        Ok(Kernel {
            stdin: Mutex::new(stdin),
            stdout: Mutex::new(FramedRead::new(
                stdout,
                LinesCodec::new_with_max_length(MAX_LINE_BYTES),
            )),
            child: Mutex::new(child),
            last_used: std::sync::Mutex::new(Instant::now()),
        })
    }

    /// One request and its one answer line. It runs in its own task, so a caller that gives up
    /// (a closed browser tab) cannot leave the answer unread for the next request. Any failure
    /// shuts the kernel down: its state is unknown, so it is not reused.
    async fn request(
        &self,
        notebook: &NotebookId,
        kernel: &Arc<Kernel>,
        request: &str,
        wait: Duration,
    ) -> Result<String, KernelError> {
        let (this, id, kernel, request) = (
            self.clone(),
            notebook.clone(),
            kernel.clone(),
            request.to_owned(),
        );
        tokio::spawn(async move { this.exchange(&id, &kernel, &request, wait).await })
            .await
            .map_err(|e| stopped(notebook, e))?
    }

    async fn exchange(
        &self,
        notebook: &NotebookId,
        kernel: &Arc<Kernel>,
        request: &str,
        wait: Duration,
    ) -> Result<String, KernelError> {
        let mut stdout = kernel.stdout.lock().await;
        kernel.touch();
        let answer = match kernel.send(request).await {
            Err(e) => Err(e.to_string()),
            Ok(()) => match tokio::time::timeout(wait, stdout.next()).await {
                Ok(Some(Ok(line))) => Ok(line),
                Ok(Some(Err(e))) => Err(e.to_string()),
                Ok(None) => Err("the kernel host exited".into()),
                Err(_) => Err(format!("no answer in {wait:?}")),
            },
        };
        kernel.touch();
        drop(stdout);
        match answer {
            Ok(line) => Ok(line),
            Err(why) => {
                self.stop_failed(notebook, kernel).await;
                Err(stopped(notebook, why))
            }
        }
    }

    async fn answer<T: serde::de::DeserializeOwned>(
        &self,
        notebook: &NotebookId,
        kernel: &Arc<Kernel>,
        line: &str,
    ) -> Result<T, KernelError> {
        match parse(line) {
            Ok(answer) => Ok(answer),
            Err(e) => {
                self.stop_failed(notebook, kernel).await;
                Err(stopped(notebook, format!("invalid answer: {e}")))
            }
        }
    }

    async fn stop(&self, notebook: &str) {
        let removed = self.live.lock().await.remove(notebook);
        if let Some(kernel) = removed {
            kernel.close(notebook).await;
        }
    }

    /// Shut down the kernel that failed, unless it was already replaced: a late failure of a
    /// restarted kernel must not stop the fresh one.
    async fn stop_failed(&self, notebook: &NotebookId, failed: &Arc<Kernel>) {
        let removed = {
            let mut live = self.live.lock().await;
            let current = live
                .get(notebook.as_str())
                .is_some_and(|k| Arc::ptr_eq(k, failed));
            if current {
                live.remove(notebook.as_str())
            } else {
                None
            }
        };
        if let Some(kernel) = removed {
            kernel.close(notebook.as_str()).await;
        }
    }
}

/// A request line, checked against the contract before it is sent.
fn kernel_request(value: serde_json::Value) -> Result<String, KernelError> {
    let request: NotebookKernelRequest =
        parse(&value.to_string()).map_err(|e| KernelError::Request(e.to_string()))?;
    serde_json::to_string(&request).map_err(|e| KernelError::Request(e.to_string()))
}

fn stopped(notebook: &NotebookId, why: impl ToString) -> KernelError {
    KernelError::Stopped {
        notebook: notebook.as_str().to_owned(),
        why: why.to_string(),
    }
}
