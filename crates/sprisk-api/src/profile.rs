//! `GET /artifacts/{id}/profile` (ADR-0038): Python profiles one table for the Datasets view.

use std::path::Path;
use std::time::Duration;

use sprisk_contracts::{DatasetProfile, parse};

use crate::bounded::{BoundedProcess, ProcessError};

/// The command that profiles a table (`python -m sprisk_profile.dataset`), how long it may
/// take, and how many may run at once.
#[derive(Clone, Debug)]
pub struct Profiler(BoundedProcess);

impl Profiler {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(BoundedProcess::new(
            "dataset profiler",
            command,
            timeout,
            at_once,
        ))
    }

    /// The profile of the Parquet file at `path`, checked against the contract.
    pub async fn profile(&self, path: &Path) -> Result<DatasetProfile, ProcessError> {
        let text = self.0.run(path.display().to_string().into_bytes()).await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid profile: {e}")))
    }
}
