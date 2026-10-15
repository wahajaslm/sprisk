//! Metadata store. SQLite today; a repository trait is extracted when Postgres lands.
//!
//! Rows keep the full contract JSON in `body`, so reads return exactly what was written.

use serde::Serialize;
use serde::de::DeserializeOwned;
use sprisk_contracts::{Artifact, ArtifactId, Attempt, AttemptId, AttemptState, Run, RunId};
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
    #[error("corrupt stored JSON: {0}")]
    Corrupt(#[from] serde_json::Error),
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
        let mut tx = self.pool.begin().await?;
        let body: Option<String> = sqlx::query_scalar("SELECT body FROM attempts WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&mut *tx)
            .await?;
        let mut attempt: Attempt = from_json(body, "attempt", id.as_str())?;
        let from = attempt.state;
        attempt.state = transition(from, to)?;
        sqlx::query("UPDATE attempts SET state = ?, body = ? WHERE id = ?")
            .bind(to.to_string())
            .bind(to_json(&attempt)?)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO audit_events (at, entity_id, event) VALUES (?, ?, ?)")
            .bind(at)
            .bind(id.as_str())
            .bind(format!("attempt.{from}->{to}"))
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(attempt)
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
