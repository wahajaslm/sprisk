//! `GET /artifacts/{id}/profile` (ADR-0038): Python profiles one table for the Datasets view.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use sprisk_contracts::{DataFormat, DatasetProfile, KeyMatches, TableShift, parse};

use crate::bounded::{BoundedProcess, ProcessError};

/// The command that profiles a table (`python -m sprisk_profile.dataset`), how long it may
/// take, how many may run at once, and the digest of its code: a stored profile is kept under
/// it, so new profiler code profiles each table again (ADR-0065).
#[derive(Clone, Debug)]
pub struct Profiler {
    process: BoundedProcess,
    code: String,
}

impl Profiler {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize, code: String) -> Self {
        Self {
            process: BoundedProcess::new("dataset profiler", command, timeout, at_once),
            code,
        }
    }

    /// The digest of the profiler's code.
    pub fn code(&self) -> &str {
        &self.code
    }

    /// The profile of the Parquet file at `path`, checked against the contract, relating the
    /// columns to `target` when one is given.
    pub async fn profile(
        &self,
        path: &Path,
        target: Option<&str>,
    ) -> Result<DatasetProfile, ProcessError> {
        let input = format!("{}\n{}", path.display(), target.unwrap_or(""));
        let text = self.process.run(input.into_bytes()).await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid profile: {e}")))
    }
}

/// The command that profiles a registered data source in place
/// (`python -m sprisk_profile.source`, ADR-0067), how long it may take, and how many at once.
#[derive(Clone, Debug)]
pub struct SourceProfiler(BoundedProcess);

impl SourceProfiler {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(BoundedProcess::new(
            "source profiler",
            command,
            timeout,
            at_once,
        ))
    }

    /// The profile of the first rows of `files`, checked against the contract. The files were
    /// listed by Rust and hold no line breaks.
    pub async fn profile(
        &self,
        format: DataFormat,
        files: &[String],
        target: Option<&str>,
    ) -> Result<DatasetProfile, ProcessError> {
        let input = format!("{format}\n{}\n{}\n", target.unwrap_or(""), files.join("\n"));
        let text = self.0.run(input.into_bytes()).await?;
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
        let profile = profiler.profile(path, None).await?;
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

/// The command that compares one table's numeric columns with another's
/// (`python -m sprisk_profile.shift`, ADR-0065), how long it may take, and how many at once.
#[derive(Clone, Debug)]
pub struct Shifter(BoundedProcess);

impl Shifter {
    pub fn new(command: Vec<String>, timeout: Duration, at_once: usize) -> Self {
        Self(BoundedProcess::new(
            "table shift",
            command,
            timeout,
            at_once,
        ))
    }

    /// How the Parquet table at `rows` differs from the one at `other`, checked against the
    /// contract.
    pub async fn shift(&self, rows: &Path, other: &Path) -> Result<TableShift, ProcessError> {
        let paths = format!("{}\n{}\n", rows.display(), other.display());
        let text = self.0.run(paths.into_bytes()).await?;
        parse(&text).map_err(|e| ProcessError::Failed(format!("invalid table shift: {e}")))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn profiler(command: &[&str], timeout: Duration) -> Profiler {
        Profiler::new(
            command.iter().map(|s| s.to_string()).collect(),
            timeout,
            1,
            "sha256:test".into(),
        )
    }

    #[tokio::test]
    async fn a_profiler_that_fails_says_so_without_its_error_text() {
        let failed = profiler(
            &["sh", "-c", "echo /secret/path >&2; exit 3"],
            Duration::from_secs(5),
        )
        .profile(Path::new("t.parquet"), None)
        .await;
        let Err(ProcessError::Failed(why)) = failed else {
            panic!("expected a failure, got {failed:?}");
        };
        assert!(!why.contains("/secret/path"), "{why}");
    }

    #[tokio::test]
    async fn a_profiler_that_takes_too_long_is_stopped() {
        let slow = profiler(&["sleep", "5"], Duration::from_millis(100))
            .profile(Path::new("t.parquet"), None)
            .await;
        assert!(matches!(slow, Err(ProcessError::Timeout(_))), "{slow:?}");
    }

    #[tokio::test]
    async fn output_that_is_not_a_profile_is_refused() {
        let wrong = profiler(&["echo", "{}"], Duration::from_secs(5))
            .profile(Path::new("t.parquet"), None)
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
