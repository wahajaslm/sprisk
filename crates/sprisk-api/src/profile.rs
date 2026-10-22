//! `GET /artifacts/{id}/profile` (ADR-0038): Python profiles one table for the Datasets view.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use sprisk_contracts::{DatasetProfile, KeyMatches, parse};

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

/// The profiles made for one request, by the table's content hash: a review asks many rules
/// about the same table, and each would profile it again. Kept only for the request, so the
/// API holds no state between requests.
#[derive(Default)]
pub struct Profiles(HashMap<String, DatasetProfile>);

impl Profiles {
    /// The profile of the table at `path`, whose content hash is `content`, made once.
    pub async fn of(
        &mut self,
        profiler: &Profiler,
        content: &str,
        path: &Path,
    ) -> Result<DatasetProfile, ProcessError> {
        if let Some(made) = self.0.get(content) {
            return Ok(made.clone());
        }
        let profile = profiler.profile(path).await?;
        self.0.insert(content.to_owned(), profile.clone());
        Ok(profile)
    }
}

/// The command that matches the rows a step reads to another table, per shared column
/// (`python -m sprisk_profile.keys`, ADR-0059), how long it may take, and how many at once.
#[derive(Clone, Debug)]
pub struct KeyMatcher(BoundedProcess);

impl KeyMatcher {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(BoundedProcess::new(
            "key matcher",
            command,
            timeout,
            at_once,
        ))
    }

    /// How the Parquet table at `rows` matches the one at `other`, checked against the contract.
    pub async fn matches(&self, rows: &Path, other: &Path) -> Result<KeyMatches, ProcessError> {
        let paths = format!("{}\n{}\n", rows.display(), other.display());
        let text = self.0.run(paths.into_bytes()).await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid key matches: {e}")))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn profiler(command: &[&str], timeout: Duration) -> Profiler {
        Profiler::new(command.iter().map(|s| s.to_string()).collect(), timeout, 1)
    }

    #[tokio::test]
    async fn a_profiler_that_fails_says_so_without_its_error_text() {
        let failed = profiler(
            &["sh", "-c", "echo /secret/path >&2; exit 3"],
            Duration::from_secs(5),
        )
        .profile(Path::new("t.parquet"))
        .await;
        let Err(ProcessError::Failed(why)) = failed else {
            panic!("expected a failure, got {failed:?}");
        };
        assert!(!why.contains("/secret/path"), "{why}");
    }

    #[tokio::test]
    async fn a_profiler_that_takes_too_long_is_stopped() {
        let slow = profiler(&["sleep", "5"], Duration::from_millis(100))
            .profile(Path::new("t.parquet"))
            .await;
        assert!(matches!(slow, Err(ProcessError::Timeout(_))), "{slow:?}");
    }

    #[tokio::test]
    async fn output_that_is_not_a_profile_is_refused() {
        let wrong = profiler(&["echo", "{}"], Duration::from_secs(5))
            .profile(Path::new("t.parquet"))
            .await;
        assert!(matches!(wrong, Err(ProcessError::Failed(_))), "{wrong:?}");
    }

    #[tokio::test]
    async fn one_request_profiles_each_table_once() {
        let runs = tempfile::NamedTempFile::new().unwrap();
        let profile = r#"{"total_rows":1,"total_columns":0,"profiled_rows":1,"band_rows":1,"columns":[],"correlation":{"columns":[],"pairs":[]}}"#;
        let script = format!("echo run >> {}; echo '{profile}'", runs.path().display());
        let counting = profiler(&["sh", "-c", &script], Duration::from_secs(5));
        let mut profiles = Profiles::default();

        for content in ["sha256:a", "sha256:a", "sha256:b"] {
            profiles
                .of(&counting, content, Path::new("t.parquet"))
                .await
                .unwrap();
        }

        let made = std::fs::read_to_string(runs.path()).unwrap();
        assert_eq!(made.lines().count(), 2, "{made}");
    }

    #[tokio::test]
    async fn output_that_is_not_key_matches_is_refused() {
        let command = vec!["echo".to_owned(), "{}".to_owned()];
        let wrong = KeyMatcher::new(command, Duration::from_secs(5), 1)
            .matches(Path::new("x.parquet"), Path::new("y.parquet"))
            .await;
        assert!(matches!(wrong, Err(ProcessError::Failed(_))), "{wrong:?}");
    }
}
