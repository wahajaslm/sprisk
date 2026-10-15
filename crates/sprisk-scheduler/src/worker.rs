use std::future::Future;

use sprisk_contracts::{WorkerId, WorkerMessage};

#[derive(Debug, thiserror::Error)]
pub enum WorkerError {
    #[error("start worker: {0}")]
    Spawn(std::io::Error),
    #[error("worker io: {0}")]
    Io(#[from] std::io::Error),
    #[error("worker exited")]
    Exited,
    #[error("worker protocol: {0}")]
    Protocol(String),
}

/// One connected worker process. Dropping it stops the process.
pub trait Worker: Send {
    fn id(&self) -> &WorkerId;
    fn send(
        &mut self,
        message: &WorkerMessage,
    ) -> impl Future<Output = Result<(), WorkerError>> + Send;
    fn recv(&mut self) -> impl Future<Output = Result<WorkerMessage, WorkerError>> + Send;
}

/// Starts workers. The real implementation spawns processes; tests use a fake.
pub trait Workers {
    type Worker: Worker;
    fn spawn(&mut self) -> impl Future<Output = Result<Self::Worker, WorkerError>> + Send;
}
