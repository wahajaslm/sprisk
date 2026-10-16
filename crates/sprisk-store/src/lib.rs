//! Metadata store. SQLite today; a repository trait is extracted when Postgres lands.
//!
//! Rows keep the full contract JSON in `body`, so reads return exactly what was written.

use serde::Serialize;
use serde::de::DeserializeOwned;
use sprisk_contracts::{
    Artifact, ArtifactId, Attempt, AttemptId, AttemptState, PipelineVersion, PipelineVersionId,
    Run, RunId, RunStatus, Timestamp, WorkerId,
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
    #[error("invalid timestamp {0}")]
    BadTimestamp(String),
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
        sqlx::query("INSERT INTO pipeline_versions (id, project_id, body) VALUES (?, ?, ?)")
            .bind(pipeline.id.as_str())
            .bind(pipeline.project_id.as_str())
            .bind(to_json(pipeline)?)
            .execute(&self.pool)
            .await?;
        Ok(())
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

    pub async fn insert_run(&self, run: &Run) -> Result<(), StoreError> {
        sqlx::query("INSERT INTO runs (id, project_id, status, body) VALUES (?, ?, ?, ?)")
            .bind(run.id.as_str())
            .bind(run.project_id.as_str())
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
    pub async fn succeed_attempt(
        &self,
        id: &AttemptId,
        outputs: &[(String, Artifact)],
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
