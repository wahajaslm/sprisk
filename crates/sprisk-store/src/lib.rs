//! Metadata store. SQLite today; a repository trait is extracted when Postgres lands.
//!
//! Rows keep the full contract JSON in `body`, so reads return exactly what was written.

use serde::Serialize;
use serde::de::DeserializeOwned;
use sprisk_contracts::{
    Artifact, ArtifactId, Attempt, AttemptId, AttemptState, DecisionProposal, InvestigationId,
    MethodologyDecision, MethodologyDecisionId, MethodologyProposalId, NodeId, NotebookId,
    NotebookVersion, NotebookVersionId, PipelineVersion, PipelineVersionId, QuestionVersion,
    QuestionVersionId, Run, RunId, RunStatus, Timestamp, WorkerId,
};
use sprisk_core::attempt::{TransitionError, transition};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("{entity} {id} not found")]
    NotFound { entity: &'static str, id: String },
    #[error("conflict: {0}")]
    Conflict(String),
    #[error(transparent)]
    Transition(#[from] TransitionError),
    #[error("attempt {id} is {state}; it no longer holds a lease")]
    NotLive { id: String, state: AttemptState },
    #[error("run {id} already finished as {status}")]
    RunFinished { id: String, status: RunStatus },
    #[error("corrupt stored JSON: {0}")]
    Corrupt(#[from] serde_json::Error),
    #[error("cache entry has an invalid attempt id {0:?}")]
    BadCacheEntry(String),
    #[error("invalid timestamp {0}")]
    BadTimestamp(String),
    #[error("stored id {0:?} is not valid")]
    BadId(String),
    #[error("database: {0}")]
    Db(sqlx::Error),
}

impl From<sqlx::Error> for StoreError {
    fn from(e: sqlx::Error) -> Self {
        match e.as_database_error() {
            Some(db) if db.is_unique_violation() => StoreError::Conflict(db.message().to_owned()),
            _ => StoreError::Db(e),
        }
    }
}

/// One output a step committed, with the run and version it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct RunOutput {
    pub pipeline_version_id: PipelineVersionId,
    pub run_id: RunId,
    pub node_id: String,
    pub port: String,
    pub artifact: Artifact,
}

pub struct SqliteStore {
    pool: SqlitePool,
}

impl SqliteStore {
    pub async fn connect(options: SqliteConnectOptions) -> Result<Self, StoreError> {
        let options = options.foreign_keys(true);
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        sqlx::migrate!("migrations/sqlite")
            .run(&pool)
            .await
            .map_err(|e| StoreError::Db(e.into()))?;
        Ok(Self { pool })
    }

    /// The local database file, created if missing. WAL lets readers run during a write.
    pub async fn open(path: &std::path::Path) -> Result<Self, StoreError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        Self::connect(options).await
    }

    /// One connection: an in-memory database is private to its connection.
    pub async fn in_memory() -> Result<Self, StoreError> {
        let options = SqliteConnectOptions::new()
            .in_memory(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        sqlx::migrate!("migrations/sqlite")
            .run(&pool)
            .await
            .map_err(|e| StoreError::Db(e.into()))?;
        Ok(Self { pool })
    }

    pub async fn insert_pipeline_version(
        &self,
        pipeline: &PipelineVersion,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO pipeline_versions (id, project_id, compares_proposal_id, body) VALUES (?, ?, ?, ?)",
        )
        .bind(pipeline.id.as_str())
        .bind(pipeline.project_id.as_str())
        .bind(pipeline.compares.as_ref().map(|p| p.as_str()))
        .bind(to_json(pipeline)?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The newest comparison of a proposal for `step` of `pipeline` (ADR-0047), if one was built.
    pub async fn comparison_for(
        &self,
        pipeline: &PipelineVersionId,
        step: &NodeId,
    ) -> Result<Option<PipelineVersion>, StoreError> {
        let body: Option<String> = sqlx::query_scalar(
            "SELECT v.body FROM pipeline_versions v \
             JOIN methodology_proposals p ON p.id = v.compares_proposal_id \
             WHERE p.pipeline_version_id = ? AND p.subject_node_id = ? \
             ORDER BY v.id DESC LIMIT 1",
        )
        .bind(pipeline.as_str())
        .bind(step.as_str())
        .fetch_optional(&self.pool)
        .await?;
        Ok(body.map(|b| serde_json::from_str(&b)).transpose()?)
    }

    /// The version comparing `proposal`'s shortlist (ADR-0046), if one was built.
    pub async fn comparison_of(
        &self,
        proposal: &MethodologyProposalId,
    ) -> Result<Option<PipelineVersion>, StoreError> {
        let body: Option<String> =
            sqlx::query_scalar("SELECT body FROM pipeline_versions WHERE compares_proposal_id = ?")
                .bind(proposal.as_str())
                .fetch_optional(&self.pool)
                .await?;
        Ok(body.map(|b| serde_json::from_str(&b)).transpose()?)
    }

    pub async fn get_pipeline_version(
        &self,
        id: &PipelineVersionId,
    ) -> Result<PipelineVersion, StoreError> {
        let body: Option<String> =
            sqlx::query_scalar("SELECT body FROM pipeline_versions WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await?;
        from_json(body, "pipeline version", id.as_str())
    }

    pub async fn has_pipeline_child(&self, id: &PipelineVersionId) -> Result<bool, StoreError> {
        let pattern = format!("%\"parent_id\":\"{}\"%", id.as_str());
        let found: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM pipeline_versions WHERE body LIKE ? LIMIT 1")
                .bind(pattern)
                .fetch_optional(&self.pool)
                .await?;
        Ok(found.is_some())
    }

    /// Whether `id` has a child that is not a branch applied from `proposal` (ADR-0047).
    pub async fn has_other_child(
        &self,
        id: &PipelineVersionId,
        proposal: &MethodologyProposalId,
    ) -> Result<bool, StoreError> {
        let pattern = format!("%\"parent_id\":\"{}\"%", id.as_str());
        let found: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM pipeline_versions WHERE body LIKE ? AND id NOT IN \
             (SELECT pipeline_version_id FROM methodology_decisions WHERE proposal_id = ?) LIMIT 1",
        )
        .bind(pattern)
        .bind(proposal.as_str())
        .fetch_optional(&self.pool)
        .await?;
        Ok(found.is_some())
    }

    /// Every decision applied from `proposal`, oldest first.
    pub async fn decisions_of(
        &self,
        proposal: &MethodologyProposalId,
    ) -> Result<Vec<MethodologyDecision>, StoreError> {
        let bodies: Vec<String> = sqlx::query_scalar(
            "SELECT body FROM methodology_decisions WHERE proposal_id = ? ORDER BY id",
        )
        .bind(proposal.as_str())
        .fetch_all(&self.pool)
        .await?;
        bodies
            .iter()
            .map(|b| Ok(serde_json::from_str(b)?))
            .collect()
    }

    pub async fn insert_question_version(
        &self,
        question: &QuestionVersion,
    ) -> Result<(), StoreError> {
        sqlx::query("INSERT INTO question_versions (id, investigation_id, body) VALUES (?, ?, ?)")
            .bind(question.id.as_str())
            .bind(question.investigation_id.as_str())
            .bind(to_json(question)?)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_question_version(
        &self,
        id: &QuestionVersionId,
    ) -> Result<QuestionVersion, StoreError> {
        let body: Option<String> =
            sqlx::query_scalar("SELECT body FROM question_versions WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await?;
        from_json(body, "question version", id.as_str())
    }

    pub async fn list_question_versions(
        &self,
        investigation: Option<&InvestigationId>,
        before: Option<&QuestionVersionId>,
        limit: u32,
    ) -> Result<Vec<QuestionVersion>, StoreError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, body FROM question_versions \
             WHERE (?1 IS NULL OR investigation_id = ?1) \
             AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT ?3",
        )
        .bind(investigation.map(|id| id.as_str()))
        .bind(before.map(|id| id.as_str()))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        parse_all(rows, "question version")
    }

    pub async fn insert_methodology_proposal(
        &self,
        proposal: &DecisionProposal,
    ) -> Result<(), StoreError> {
        sqlx::query("INSERT INTO methodology_proposals (id, pipeline_version_id, question_version_id, subject_node_id, body) VALUES (?, ?, ?, ?, ?)")
            .bind(proposal.id.as_str())
            .bind(proposal.pipeline_version_id.as_str())
            .bind(proposal.question_version_id.as_str())
            .bind(proposal.subject_node_id.as_str())
            .bind(to_json(proposal)?)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_methodology_proposal(
        &self,
        id: &MethodologyProposalId,
    ) -> Result<DecisionProposal, StoreError> {
        let body: Option<String> =
            sqlx::query_scalar("SELECT body FROM methodology_proposals WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await?;
        from_json(body, "methodology proposal", id.as_str())
    }

    pub async fn list_methodology_decisions(
        &self,
        pipeline: Option<&PipelineVersionId>,
    ) -> Result<Vec<MethodologyDecision>, StoreError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, body FROM methodology_decisions WHERE (?1 IS NULL OR pipeline_version_id = ?1) ORDER BY id DESC",
        ).bind(pipeline.map(|id| id.as_str())).fetch_all(&self.pool).await?;
        parse_all(rows, "methodology decision")
    }

    pub async fn get_methodology_decision(
        &self,
        id: &MethodologyDecisionId,
    ) -> Result<MethodologyDecision, StoreError> {
        let body: Option<String> =
            sqlx::query_scalar("SELECT body FROM methodology_decisions WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await?;
        from_json(body, "methodology decision", id.as_str())
    }

    /// The decisions with these ids. An unknown id is left out.
    pub async fn methodology_decisions(
        &self,
        ids: &[MethodologyDecisionId],
    ) -> Result<Vec<MethodologyDecision>, StoreError> {
        let ids = serde_json::to_string(&ids.iter().map(|id| id.as_str()).collect::<Vec<_>>())?;
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, body FROM methodology_decisions \
             WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id",
        )
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        parse_all(rows, "methodology decision")
    }

    pub async fn methodology_decision_by_key(
        &self,
        key: &str,
    ) -> Result<Option<MethodologyDecision>, StoreError> {
        let body: Option<String> =
            sqlx::query_scalar("SELECT body FROM methodology_decisions WHERE idempotency_key = ?")
                .bind(key)
                .fetch_optional(&self.pool)
                .await?;
        body.map(|body| serde_json::from_str(&body))
            .transpose()
            .map_err(StoreError::from)
    }

    /// Commits the applied graph and its decision in one transaction. A repeated key returns
    /// the original decision, so a lost HTTP response cannot create a second graph version.
    pub async fn apply_methodology_decision(
        &self,
        decision: &MethodologyDecision,
        pipeline: &PipelineVersion,
        idempotency_key: &str,
    ) -> Result<MethodologyDecision, StoreError> {
        let mut tx = self.pool.begin().await?;
        let existing: Option<String> =
            sqlx::query_scalar("SELECT body FROM methodology_decisions WHERE idempotency_key = ?")
                .bind(idempotency_key)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some(body) = existing {
            tx.rollback().await?;
            return Ok(serde_json::from_str(&body)?);
        }
        sqlx::query("INSERT INTO pipeline_versions (id, project_id, body) VALUES (?, ?, ?)")
            .bind(pipeline.id.as_str())
            .bind(pipeline.project_id.as_str())
            .bind(to_json(pipeline)?)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO methodology_decisions (id, proposal_id, pipeline_version_id, idempotency_key, body) VALUES (?, ?, ?, ?, ?)")
            .bind(decision.id.as_str()).bind(decision.proposal_id.as_str())
            .bind(decision.pipeline_version_id.as_str()).bind(idempotency_key).bind(to_json(decision)?)
            .execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(decision.clone())
    }

    pub async fn insert_notebook_version(
        &self,
        version: &NotebookVersion,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO notebook_versions (id, notebook_id, project_id, body) VALUES (?, ?, ?, ?)",
        )
        .bind(version.id.as_str())
        .bind(version.notebook_id.as_str())
        .bind(version.project_id.as_str())
        .bind(to_json(version)?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_notebook_version(
        &self,
        id: &NotebookVersionId,
    ) -> Result<NotebookVersion, StoreError> {
        let body: Option<String> =
            sqlx::query_scalar("SELECT body FROM notebook_versions WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await?;
        from_json(body, "notebook version", id.as_str())
    }

    pub async fn has_notebook(&self, id: &NotebookId) -> Result<bool, StoreError> {
        let found: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM notebook_versions WHERE notebook_id = ? LIMIT 1")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await?;
        Ok(found.is_some())
    }

    /// Each notebook's newest version, newest notebooks first, at most `limit`.
    /// A notebook whose newest version is removed (ADR-0041) is left out.
    pub async fn latest_notebook_versions(
        &self,
        limit: u32,
    ) -> Result<Vec<NotebookVersion>, StoreError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, body FROM notebook_versions v WHERE id = \
             (SELECT MAX(id) FROM notebook_versions WHERE notebook_id = v.notebook_id) \
             AND json_extract(body, '$.removed') IS NOT 1 \
             ORDER BY id DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        parse_all(rows, "notebook version")
    }

    /// Append to the audit trail outside a run, e.g. a notebook cell executed (ADR-0036).
    pub async fn append_audit(
        &self,
        at: &str,
        entity_id: &str,
        event: &str,
    ) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        audit(&mut tx, at, entity_id, event).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn insert_run(&self, run: &Run) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO runs (id, project_id, pipeline_version_id, status, body) VALUES (?, ?, ?, ?, ?)",
        )
            .bind(run.id.as_str())
            .bind(run.project_id.as_str())
            .bind(run.pipeline_version_id.as_str())
            .bind(run.status.to_string())
            .bind(to_json(run)?)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_run(&self, id: &RunId) -> Result<Run, StoreError> {
        let body: Option<String> = sqlx::query_scalar("SELECT body FROM runs WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await?;
        from_json(body, "run", id.as_str())
    }

    /// Newest first, at most `limit`, optionally for one pipeline version and before a run id.
    pub async fn list_runs(
        &self,
        pipeline_version: Option<&PipelineVersionId>,
        before: Option<&RunId>,
        limit: u32,
    ) -> Result<Vec<Run>, StoreError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, body FROM runs WHERE (?1 IS NULL OR pipeline_version_id = ?1) \
             AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT ?3",
        )
        .bind(pipeline_version.map(|p| p.as_str()))
        .bind(before.map(|r| r.as_str()))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        parse_all(rows, "run")
    }

    /// Newest first, at most `limit`, optionally before a version id.
    pub async fn list_pipeline_versions(
        &self,
        before: Option<&PipelineVersionId>,
        limit: u32,
    ) -> Result<Vec<PipelineVersion>, StoreError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, body FROM pipeline_versions WHERE (?1 IS NULL OR id < ?1) ORDER BY id DESC LIMIT ?2",
        )
        .bind(before.map(|p| p.as_str()))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        parse_all(rows, "pipeline version")
    }

    pub async fn insert_attempt(&self, attempt: &Attempt) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO attempts (id, run_id, node_id, number, state, body) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(attempt.id.as_str())
        .bind(attempt.run_id.as_str())
        .bind(attempt.node_id.as_str())
        .bind(attempt.number.get() as i64)
        .bind(attempt.state.to_string())
        .bind(to_json(attempt)?)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_attempts(&self, run_id: &RunId) -> Result<Vec<Attempt>, StoreError> {
        let bodies: Vec<String> = sqlx::query_scalar(
            "SELECT body FROM attempts WHERE run_id = ? ORDER BY node_id, number",
        )
        .bind(run_id.as_str())
        .fetch_all(&self.pool)
        .await?;
        bodies
            .iter()
            .map(|b| serde_json::from_str(b).map_err(StoreError::from))
            .collect()
    }

    /// Move an attempt to `to` if ADR-0013 allows it, and audit the change, in one transaction.
    /// An illegal move (e.g. a late worker result for a finished attempt) changes nothing.
    pub async fn transition_attempt(
        &self,
        id: &AttemptId,
        to: AttemptState,
        at: &str,
    ) -> Result<Attempt, StoreError> {
        self.change_attempt(id, to, at, |_| {}).await
    }

    /// Move to `failed` or `timed_out` and record why.
    pub async fn fail_attempt(
        &self,
        id: &AttemptId,
        to: AttemptState,
        error: &sprisk_contracts::Error,
        at: &str,
    ) -> Result<Attempt, StoreError> {
        self.change_attempt(id, to, at, |a| a.error = Some(error.clone()))
            .await
    }

    /// `queued -> leased`, recording which worker holds it and until when.
    pub async fn lease_attempt(
        &self,
        id: &AttemptId,
        worker: &WorkerId,
        expires_at: &Timestamp,
        at: &str,
    ) -> Result<Attempt, StoreError> {
        self.change_attempt(id, AttemptState::Leased, at, |a| {
            a.worker_id = Some(worker.clone());
            a.lease_expires_at = Some(expires_at.clone());
        })
        .await
    }

    /// Push the lease expiry of an attempt a worker still holds. Not audited: heartbeats are frequent.
    pub async fn extend_lease(
        &self,
        id: &AttemptId,
        expires_at: &Timestamp,
    ) -> Result<Attempt, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut attempt = read_attempt(&mut tx, id).await?;
        if !matches!(
            attempt.state,
            AttemptState::Leased | AttemptState::Running | AttemptState::Uploading
        ) {
            return Err(StoreError::NotLive {
                id: id.to_string(),
                state: attempt.state,
            });
        }
        attempt.lease_expires_at = Some(expires_at.clone());
        write_attempt(&mut tx, &attempt).await?;
        tx.commit().await?;
        Ok(attempt)
    }

    async fn change_attempt(
        &self,
        id: &AttemptId,
        to: AttemptState,
        at: &str,
        edit: impl FnOnce(&mut Attempt),
    ) -> Result<Attempt, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut attempt = read_attempt(&mut tx, id).await?;
        let from = attempt.state;
        attempt.state = transition(from, to)?;
        edit(&mut attempt);
        write_attempt(&mut tx, &attempt).await?;
        audit(&mut tx, at, id.as_str(), &format!("attempt.{from}->{to}")).await?;
        tx.commit().await?;
        Ok(attempt)
    }

    /// `uploading -> succeeded`, recording each output artifact and the port that produced it,
    /// all in one transaction. A duplicate or late completion fails the transition and records nothing.
    /// With a `cache_key`, the outputs become reusable by later attempts with the same key.
    pub async fn succeed_attempt(
        &self,
        id: &AttemptId,
        outputs: &[(String, Artifact)],
        cache_key: Option<&str>,
        at: &str,
    ) -> Result<Attempt, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut attempt = read_attempt(&mut tx, id).await?;
        let from = attempt.state;
        attempt.state = transition(from, AttemptState::Succeeded)?;
        for (port, artifact) in outputs {
            sqlx::query("INSERT INTO artifacts (id, content_hash, body) VALUES (?, ?, ?)")
                .bind(artifact.id.as_str())
                .bind(artifact.content_hash.as_str())
                .bind(to_json(artifact)?)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "INSERT INTO attempt_outputs (attempt_id, port, artifact_id) VALUES (?, ?, ?)",
            )
            .bind(id.as_str())
            .bind(port)
            .bind(artifact.id.as_str())
            .execute(&mut *tx)
            .await?;
        }
        if let Some(key) = cache_key {
            sqlx::query(
                "INSERT OR IGNORE INTO cache_entries (cache_key, attempt_id) VALUES (?, ?)",
            )
            .bind(key)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await?;
        }
        write_attempt(&mut tx, &attempt).await?;
        audit(
            &mut tx,
            at,
            id.as_str(),
            &format!("attempt.{from}->succeeded"),
        )
        .await?;
        tx.commit().await?;
        Ok(attempt)
    }

    /// The succeeded attempt recorded under `cache_key`, if any.
    pub async fn cached_attempt(&self, cache_key: &str) -> Result<Option<AttemptId>, StoreError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT attempt_id FROM cache_entries WHERE cache_key = ?")
                .bind(cache_key)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|(id,)| {
            id.parse()
                .map_err(|_| StoreError::BadCacheEntry(id.clone()))
        })
        .transpose()
    }

    /// Remember which step definition a finished attempt ran, so a later run that starts from
    /// an edit can reuse it (ADR-0026). Recording the same attempt twice keeps the first key.
    pub async fn record_step_key(&self, attempt: &AttemptId, key: &str) -> Result<(), StoreError> {
        sqlx::query("INSERT OR IGNORE INTO step_keys (attempt_id, step_key) VALUES (?, ?)")
            .bind(attempt.as_str())
            .bind(key)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// The finished attempt of `node` in `run` that ran this step definition, if any.
    pub async fn reusable_attempt(
        &self,
        run: &RunId,
        node: &str,
        key: &str,
    ) -> Result<Option<AttemptId>, StoreError> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT a.id FROM attempts a JOIN step_keys k ON k.attempt_id = a.id \
             WHERE a.run_id = ? AND a.node_id = ? AND k.step_key = ? \
             AND a.state IN ('succeeded', 'cache_hit') ORDER BY a.number DESC LIMIT 1",
        )
        .bind(run.as_str())
        .bind(node)
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|(id,)| {
            id.parse()
                .map_err(|_| StoreError::BadCacheEntry(id.clone()))
        })
        .transpose()
    }

    /// `validated -> cache_hit`: the attempt reuses `source`'s outputs instead of running.
    /// One transaction; a wrong state records nothing.
    pub async fn hit_cache(
        &self,
        id: &AttemptId,
        source: &AttemptId,
        at: &str,
    ) -> Result<Attempt, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut attempt = read_attempt(&mut tx, id).await?;
        let from = attempt.state;
        attempt.state = transition(from, AttemptState::CacheHit)?;
        sqlx::query(
            "INSERT INTO attempt_outputs (attempt_id, port, artifact_id) \
             SELECT ?, port, artifact_id FROM attempt_outputs WHERE attempt_id = ?",
        )
        .bind(id.as_str())
        .bind(source.as_str())
        .execute(&mut *tx)
        .await?;
        write_attempt(&mut tx, &attempt).await?;
        audit(
            &mut tx,
            at,
            id.as_str(),
            &format!("attempt.{from}->cache_hit"),
        )
        .await?;
        tx.commit().await?;
        Ok(attempt)
    }

    /// `(port, artifact)` pairs an attempt committed, by port name.
    pub async fn outputs(
        &self,
        attempt: &AttemptId,
    ) -> Result<Vec<(String, Artifact)>, StoreError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT o.port, a.body FROM attempt_outputs o JOIN artifacts a ON a.id = o.artifact_id \
             WHERE o.attempt_id = ? ORDER BY o.port",
        )
        .bind(attempt.as_str())
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|(port, body)| Ok((port, serde_json::from_str(&body)?)))
            .collect()
    }

    /// Each step's outputs from the latest run of its version that committed any, for every
    /// one of `versions`, in one query. A newer run still going does not hide them.
    pub async fn latest_outputs(
        &self,
        versions: &[PipelineVersionId],
    ) -> Result<Vec<RunOutput>, StoreError> {
        let ids = serde_json::to_string(&versions.iter().map(|v| v.as_str()).collect::<Vec<_>>())?;
        let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "WITH latest AS ( \
                 SELECT r.pipeline_version_id AS version, a.node_id AS node, max(r.id) AS run \
                 FROM runs r \
                 JOIN attempts a ON a.run_id = r.id \
                 JOIN attempt_outputs o ON o.attempt_id = a.id \
                 WHERE r.pipeline_version_id IN (SELECT value FROM json_each(?)) \
                 GROUP BY r.pipeline_version_id, a.node_id) \
             SELECT l.version, l.run, l.node, o.port, art.body \
             FROM latest l \
             JOIN attempts a ON a.run_id = l.run AND a.node_id = l.node \
             JOIN attempt_outputs o ON o.attempt_id = a.id \
             JOIN artifacts art ON art.id = o.artifact_id \
             ORDER BY l.run DESC, l.node, o.port",
        )
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|(version, run, node_id, port, body)| {
                Ok(RunOutput {
                    pipeline_version_id: version.parse().map_err(|_| StoreError::BadId(version))?,
                    run_id: run.parse().map_err(|_| StoreError::BadId(run))?,
                    node_id,
                    port,
                    artifact: serde_json::from_str(&body)?,
                })
            })
            .collect()
    }

    /// Change a run's status and audit it. A finished run never changes; finishing sets `finished_at`.
    pub async fn set_run_status(
        &self,
        id: &RunId,
        to: RunStatus,
        at: &str,
    ) -> Result<Run, StoreError> {
        let mut tx = self.pool.begin().await?;
        let body: Option<String> = sqlx::query_scalar("SELECT body FROM runs WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&mut *tx)
            .await?;
        let mut run: Run = from_json(body, "run", id.as_str())?;
        let from = run.status;
        if run_finished(from) {
            return Err(StoreError::RunFinished {
                id: id.to_string(),
                status: from,
            });
        }
        run.status = to;
        if run_finished(to) {
            run.finished_at = Some(
                at.parse()
                    .map_err(|_| StoreError::BadTimestamp(at.to_owned()))?,
            );
        }
        sqlx::query("UPDATE runs SET status = ?, body = ? WHERE id = ?")
            .bind(to.to_string())
            .bind(to_json(&run)?)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await?;
        audit(&mut tx, at, id.as_str(), &format!("run.{from}->{to}")).await?;
        tx.commit().await?;
        Ok(run)
    }

    pub async fn insert_artifact(&self, artifact: &Artifact) -> Result<(), StoreError> {
        sqlx::query("INSERT INTO artifacts (id, content_hash, body) VALUES (?, ?, ?)")
            .bind(artifact.id.as_str())
            .bind(artifact.content_hash.as_str())
            .bind(to_json(artifact)?)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_artifact(&self, id: &ArtifactId) -> Result<Artifact, StoreError> {
        let body: Option<String> = sqlx::query_scalar("SELECT body FROM artifacts WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await?;
        from_json(body, "artifact", id.as_str())
    }

    /// `(at, event)` pairs for one entity, oldest first.
    pub async fn audit_events(&self, entity_id: &str) -> Result<Vec<(String, String)>, StoreError> {
        Ok(
            sqlx::query_as("SELECT at, event FROM audit_events WHERE entity_id = ? ORDER BY seq")
                .bind(entity_id)
                .fetch_all(&self.pool)
                .await?,
        )
    }
}

type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

async fn read_attempt(tx: &mut Tx<'_>, id: &AttemptId) -> Result<Attempt, StoreError> {
    let body: Option<String> = sqlx::query_scalar("SELECT body FROM attempts WHERE id = ?")
        .bind(id.as_str())
        .fetch_optional(&mut **tx)
        .await?;
    from_json(body, "attempt", id.as_str())
}

async fn write_attempt(tx: &mut Tx<'_>, attempt: &Attempt) -> Result<(), StoreError> {
    sqlx::query("UPDATE attempts SET state = ?, body = ? WHERE id = ?")
        .bind(attempt.state.to_string())
        .bind(to_json(attempt)?)
        .bind(attempt.id.as_str())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn audit(tx: &mut Tx<'_>, at: &str, entity_id: &str, event: &str) -> Result<(), StoreError> {
    sqlx::query("INSERT INTO audit_events (at, entity_id, event) VALUES (?, ?, ?)")
        .bind(at)
        .bind(entity_id)
        .bind(event)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn run_finished(status: RunStatus) -> bool {
    matches!(
        status,
        RunStatus::Succeeded | RunStatus::Failed | RunStatus::Cancelled
    )
}

/// Parse `(id, body)` rows; a bad body names its entity and id.
fn parse_all<T: DeserializeOwned>(
    rows: Vec<(String, String)>,
    entity: &'static str,
) -> Result<Vec<T>, StoreError> {
    rows.into_iter()
        .map(|(id, body)| from_json(Some(body), entity, &id))
        .collect()
}

fn to_json<T: Serialize>(value: &T) -> Result<String, StoreError> {
    Ok(serde_json::to_string(value)?)
}

fn from_json<T: DeserializeOwned>(
    body: Option<String>,
    entity: &'static str,
    id: &str,
) -> Result<T, StoreError> {
    let body = body.ok_or_else(|| StoreError::NotFound {
        entity,
        id: id.to_owned(),
    })?;
    Ok(serde_json::from_str(&body)?)
}
