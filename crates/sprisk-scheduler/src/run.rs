use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::json;
use sprisk_artifacts::ArtifactStore;
use sprisk_contracts::{
    ArtifactManifest, Attempt, AttemptId, AttemptState, Effects, FailFailureKind as FailureKind,
    RunId, RunStatus, WorkerMessage, parse,
};
use sprisk_graph::{Plan, Step};
use sprisk_store::{SqliteStore, StoreError};

use crate::next::{Next, next_step};
use crate::worker::{Worker, WorkerError, Workers};

#[derive(Debug, Clone)]
pub struct Settings {
    /// A worker that sends nothing for this long loses its lease.
    pub lease: Duration,
    /// Attempts per step, including the first.
    pub max_attempts: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            lease: Duration::from_secs(30),
            max_attempts: 3,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SchedulerError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Worker(#[from] WorkerError),
    #[error("artifact staging: {0}")]
    Staging(#[from] sprisk_artifacts::StoreError),
    #[error("staging io: {0}")]
    Io(#[from] std::io::Error),
    #[error("step {node}: input {port} has no committed output {from}")]
    MissingInput {
        node: String,
        port: String,
        from: String,
    },
    #[error("build {what}: {reason}")]
    Contract { what: &'static str, reason: String },
}

/// How one attempt ended, from the scheduler's point of view.
enum End {
    Succeeded,
    Retryable,
    Permanent,
}

pub struct Scheduler<'a, W: Workers> {
    store: &'a SqliteStore,
    artifacts: &'a ArtifactStore,
    workers: W,
    settings: Settings,
    worker: Option<W::Worker>,
}

impl<'a, W: Workers> Scheduler<'a, W> {
    pub fn new(
        store: &'a SqliteStore,
        artifacts: &'a ArtifactStore,
        workers: W,
        settings: Settings,
    ) -> Self {
        Self {
            store,
            artifacts,
            workers,
            settings,
            worker: None,
        }
    }

    /// Run every step of `plan` for `run_id` until the run succeeds or a step cannot.
    /// Safe to call again after a crash: finished steps are kept, interrupted attempts time out.
    pub async fn run(&mut self, run_id: &RunId, plan: &Plan) -> Result<RunStatus, SchedulerError> {
        if self.store.get_run(run_id).await?.status == RunStatus::Queued {
            self.store
                .set_run_status(run_id, RunStatus::Running, &now())
                .await?;
        }
        let mut done = self.reconcile(run_id).await?;
        loop {
            let succeeded: HashSet<String> = done.keys().cloned().collect();
            let step = match next_step(plan, &succeeded) {
                Next::Done => return self.finish(run_id, RunStatus::Succeeded).await,
                Next::Run(step) => step,
            };
            match self.run_step(run_id, step, &done).await? {
                Some(attempt) => {
                    done.insert(step.node_id.clone(), attempt);
                }
                None => return self.finish(run_id, RunStatus::Failed).await,
            }
        }
    }

    async fn finish(&self, run_id: &RunId, status: RunStatus) -> Result<RunStatus, SchedulerError> {
        self.store.set_run_status(run_id, status, &now()).await?;
        Ok(status)
    }

    /// Succeeded attempt per node. Attempts a previous process left in flight are timed out.
    async fn reconcile(
        &self,
        run_id: &RunId,
    ) -> Result<HashMap<String, AttemptId>, SchedulerError> {
        let mut done = HashMap::new();
        for attempt in self.store.list_attempts(run_id).await? {
            match attempt.state {
                AttemptState::Succeeded => {
                    done.insert(attempt.node_id.to_string(), attempt.id);
                }
                AttemptState::Leased | AttemptState::Running | AttemptState::Uploading => {
                    let error = error("control_plane_restarted", "attempt was in flight")?;
                    self.store
                        .fail_attempt(&attempt.id, AttemptState::TimedOut, &error, &now())
                        .await?;
                }
                AttemptState::Created | AttemptState::Validated | AttemptState::Queued => {
                    self.store
                        .transition_attempt(&attempt.id, AttemptState::Cancelled, &now())
                        .await?;
                }
                _ => {}
            }
        }
        Ok(done)
    }

    /// New attempts for one step until one succeeds (`Some`) or it cannot (`None`).
    async fn run_step(
        &mut self,
        run_id: &RunId,
        step: &Step,
        done: &HashMap<String, AttemptId>,
    ) -> Result<Option<AttemptId>, SchedulerError> {
        let previous = self
            .store
            .list_attempts(run_id)
            .await?
            .iter()
            .filter(|a| a.node_id.as_str() == step.node_id)
            .count() as u64;
        // Side-effecting steps are never retried automatically (arch doc §9).
        let cap = if step.operator.effects == Effects::SideEffecting {
            previous + 1
        } else {
            self.settings.max_attempts
        };
        for number in previous + 1..=cap.max(previous + 1) {
            let attempt = self.new_attempt(run_id, step, number).await?;
            match self.try_attempt(run_id, step, &attempt, done).await? {
                End::Succeeded => return Ok(Some(attempt.id)),
                End::Permanent => return Ok(None),
                End::Retryable => {}
            }
        }
        Ok(None)
    }

    async fn new_attempt(
        &self,
        run_id: &RunId,
        step: &Step,
        number: u64,
    ) -> Result<Attempt, SchedulerError> {
        let attempt: Attempt = build(
            "attempt",
            json!({
                "schema_version": "sprisk.attempt/v1",
                "id": format!("att_{}", ulid::Ulid::new()),
                "run_id": run_id,
                "node_id": step.node_id,
                "number": number,
                "state": "created",
                "created_at": now(),
            }),
        )?;
        self.store.insert_attempt(&attempt).await?;
        self.store
            .transition_attempt(&attempt.id, AttemptState::Validated, &now())
            .await?;
        self.store
            .transition_attempt(&attempt.id, AttemptState::Queued, &now())
            .await?;
        Ok(attempt)
    }

    async fn try_attempt(
        &mut self,
        run_id: &RunId,
        step: &Step,
        attempt: &Attempt,
        done: &HashMap<String, AttemptId>,
    ) -> Result<End, SchedulerError> {
        let id = &attempt.id;
        let lease = self.lease_message(run_id, step, id, done).await?;
        let worker = match self.worker.take() {
            Some(worker) => worker,
            None => self.workers.spawn().await?,
        };
        let mut worker = worker;
        self.store
            .lease_attempt(id, worker.id(), &self.expiry()?, &now())
            .await?;
        worker.send(&lease).await?;
        self.store
            .transition_attempt(id, AttemptState::Running, &now())
            .await?;

        let mut manifests: Vec<ArtifactManifest> = Vec::new();
        loop {
            let message = match tokio::time::timeout(self.settings.lease, worker.recv()).await {
                Err(_) => {
                    // Dropping the worker kills it; the retry gets a fresh one.
                    let e = error("lease_expired", "no message before the lease expired")?;
                    self.store
                        .fail_attempt(id, AttemptState::TimedOut, &e, &now())
                        .await?;
                    return Ok(self.retryable(step));
                }
                Ok(Err(e)) => {
                    let e = error("worker_lost", &e.to_string())?;
                    self.store
                        .fail_attempt(id, AttemptState::Failed, &e, &now())
                        .await?;
                    return Ok(self.retryable(step));
                }
                Ok(Ok(message)) => message,
            };
            match message {
                WorkerMessage::Heartbeat(m) if &m.attempt_id == id => {
                    self.store.extend_lease(id, &self.expiry()?).await?;
                }
                WorkerMessage::Progress(m) if &m.attempt_id == id => {}
                WorkerMessage::ArtifactManifest(m) if &m.attempt_id == id => manifests.push(m),
                WorkerMessage::Fail(m) if &m.attempt_id == id => {
                    self.store
                        .fail_attempt(id, AttemptState::Failed, &m.error, &now())
                        .await?;
                    self.worker = Some(worker);
                    return Ok(match m.failure_kind {
                        FailureKind::Transient => self.retryable(step),
                        FailureKind::Permanent => End::Permanent,
                    });
                }
                WorkerMessage::Complete(m) if &m.attempt_id == id => {
                    self.store
                        .transition_attempt(id, AttemptState::Uploading, &now())
                        .await?;
                    let end = self.commit(run_id, step, attempt, &manifests).await?;
                    if matches!(end, End::Succeeded) {
                        worker.send(&ack(id)?).await?;
                    }
                    self.worker = Some(worker);
                    return Ok(end);
                }
                other => {
                    // A late message for an older attempt, or one a worker must never send.
                    tracing::warn!(attempt = id.as_str(), message = ?other, "ignored worker message");
                }
            }
        }
    }

    fn retryable(&self, step: &Step) -> End {
        if step.operator.effects == Effects::SideEffecting {
            End::Permanent
        } else {
            End::Retryable
        }
    }

    /// Verify and promote every output, then record it. Promote happens before the DB row,
    /// so a crash in between leaves an unreferenced object, never a row without bytes.
    async fn commit(
        &self,
        run_id: &RunId,
        step: &Step,
        attempt: &Attempt,
        manifests: &[ArtifactManifest],
    ) -> Result<End, SchedulerError> {
        let id = &attempt.id;
        let mut declared: Vec<String> = step
            .operator
            .outputs
            .iter()
            .map(|p| p.name.to_string())
            .collect();
        declared.sort();
        let mut sent: Vec<String> = manifests.iter().map(|m| m.port.to_string()).collect();
        sent.sort();
        if declared != sent {
            let reason = format!("outputs {sent:?} do not match declared ports {declared:?}");
            return self.reject(id, &reason).await;
        }
        let project_id = self.store.get_run(run_id).await?.project_id;
        for m in manifests {
            let Some(staged) = local_path(&m.staging_uri) else {
                return self
                    .reject(
                        id,
                        &format!("unsupported staging uri {}", m.staging_uri.as_str()),
                    )
                    .await;
            };
            let committed = match self.artifacts.commit(&staged, &m.content_hash).await {
                Ok(committed) => committed,
                Err(e) => return self.reject(id, &e.to_string()).await,
            };
            let mut artifact = json!({
                "schema_version": "sprisk.artifact/v1",
                "id": format!("art_{}", ulid::Ulid::new()),
                "project_id": project_id,
                "producer_attempt_id": id,
                "content_hash": committed.content_hash,
                "media_type": m.media_type,
                "size_bytes": committed.size_bytes,
                "uri": committed.uri,
                "created_at": now(),
            });
            if let Some(schema_ref) = &m.schema_ref {
                artifact["schema_ref"] = json!(schema_ref);
            }
            self.store
                .commit_output(id, m.port.as_str(), &build("artifact", artifact)?)
                .await?;
        }
        self.store
            .transition_attempt(id, AttemptState::Succeeded, &now())
            .await?;
        Ok(End::Succeeded)
    }

    async fn reject(&self, id: &AttemptId, reason: &str) -> Result<End, SchedulerError> {
        self.store
            .fail_attempt(
                id,
                AttemptState::Failed,
                &error("manifest_rejected", reason)?,
                &now(),
            )
            .await?;
        Ok(End::Permanent)
    }

    async fn lease_message(
        &self,
        run_id: &RunId,
        step: &Step,
        attempt: &AttemptId,
        done: &HashMap<String, AttemptId>,
    ) -> Result<WorkerMessage, SchedulerError> {
        let mut inputs = Vec::new();
        for input in &step.inputs {
            let from = format!("{}.{}", input.from_node, input.from_port);
            let missing = || SchedulerError::MissingInput {
                node: step.node_id.clone(),
                port: input.port.clone(),
                from: from.clone(),
            };
            let producer = done.get(&input.from_node).ok_or_else(missing)?;
            let (_, artifact) = self
                .store
                .outputs(producer)
                .await?
                .into_iter()
                .find(|(port, _)| *port == input.from_port)
                .ok_or_else(missing)?;
            inputs.push(json!({
                "port": input.port,
                "artifact_id": artifact.id,
                "uri": artifact.uri,
                "content_hash": artifact.content_hash,
            }));
        }
        let staging = self.artifacts.staging_dir(attempt.as_str())?;
        std::fs::create_dir_all(&staging)?;
        let staging_uri = url::Url::from_directory_path(&staging)
            .map_err(|()| SchedulerError::Contract {
                what: "staging uri",
                reason: format!("{} is not absolute", staging.display()),
            })?
            .to_string();
        build(
            "lease_attempt",
            json!({
                "type": "lease_attempt",
                "attempt_id": attempt,
                "run_id": run_id,
                "node_id": step.node_id,
                "operator": step.operator.id,
                "params": step.params,
                "inputs": inputs,
                "staging_uri": staging_uri,
                "lease_expires_at": self.expiry()?,
            }),
        )
    }

    fn expiry(&self) -> Result<sprisk_contracts::Timestamp, SchedulerError> {
        let at = jiff::Timestamp::now() + self.settings.lease;
        build("timestamp", json!(format_ts(at)))
    }
}

fn local_path(uri: &str) -> Option<PathBuf> {
    url::Url::parse(uri).ok()?.to_file_path().ok()
}

fn ack(id: &AttemptId) -> Result<WorkerMessage, SchedulerError> {
    build(
        "acknowledge",
        json!({"type": "acknowledge", "attempt_id": id}),
    )
}

fn error(code: &str, message: &str) -> Result<sprisk_contracts::Error, SchedulerError> {
    build("error", json!({"code": code, "message": message}))
}

/// Build a contract value through the same parser as wire input, so it is valid by construction.
fn build<T: serde::de::DeserializeOwned>(
    what: &'static str,
    value: serde_json::Value,
) -> Result<T, SchedulerError> {
    parse(&value.to_string()).map_err(|e| SchedulerError::Contract {
        what,
        reason: e.to_string(),
    })
}

fn now() -> String {
    format_ts(jiff::Timestamp::now())
}

/// Contract timestamps are UTC, whole seconds, `Z`.
fn format_ts(at: jiff::Timestamp) -> String {
    at.strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}
