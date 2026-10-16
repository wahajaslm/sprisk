use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use tokio::time::Instant;

use serde_json::json;
use sprisk_artifacts::ArtifactStore;
use sprisk_contracts::{
    Artifact, ArtifactManifest, Attempt, AttemptId, AttemptState, Effects,
    FailFailureKind as FailureKind, MethodologyCheck, Operator, PipelineVersion, RunId, RunStatus,
    Verdict, WorkerMessage, parse,
};
use sprisk_graph::{Plan, Step};
use sprisk_store::{SqliteStore, StoreError};

use crate::cache::{cache_key, cacheable};
use crate::next::{Next, next_step};
use crate::worker::{Worker, WorkerError, Workers};

/// Reserved output every step may write: what it printed and warned (ADR-0025).
pub const CONSOLE_PORT: &str = "console";
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
    #[error("gate output: {0}")]
    GateOutput(String),
}

/// Attempts of the methodology gate use this node id (ADR-0017); Gate A reserves it.
pub const GATE_NODE: &str = sprisk_graph::RESERVED_NODE_IDS[0];

/// Where an attempt's inputs come from.
#[derive(Clone, Copy)]
enum Inputs<'p> {
    /// Outputs of the upstream steps named in the plan.
    Upstream,
    /// The pipeline version and its operators, for the methodology gate.
    Gate(&'p PipelineVersion, &'p Plan),
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
    gate: Option<Operator>,
    worker: Option<W::Worker>,
    reuse: Option<RunId>,
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
            gate: None,
            worker: None,
            reuse: None,
        }
    }

    /// Reuse `run`'s result for every step whose definition is unchanged (ADR-0026): an edit
    /// runs from the edited step onwards.
    pub fn reusing(mut self, run: RunId) -> Self {
        self.reuse = Some(run);
        self
    }

    /// Run this methodology pack entrypoint as Gate B before the first step (ADR-0017).
    pub fn with_gate(mut self, operator: Operator) -> Self {
        self.gate = Some(operator);
        self
    }

    /// Run every step of `plan` for `run_id` until the run succeeds or a step cannot.
    /// Safe to call again after a crash: finished steps are kept, interrupted attempts time out.
    /// On an error the run is marked failed, so it never stays running with no one driving it.
    pub async fn run(
        &mut self,
        run_id: &RunId,
        pipeline: &PipelineVersion,
        plan: &Plan,
    ) -> Result<RunStatus, SchedulerError> {
        let result = self.drive(run_id, pipeline, plan).await;
        if let Some(worker) = self.worker.take() {
            self.workers.release(worker);
        }
        if result.is_err() {
            match self
                .store
                .set_run_status(run_id, RunStatus::Failed, &now())
                .await
            {
                Ok(_) | Err(StoreError::RunFinished { .. }) => {}
                Err(e) => {
                    tracing::error!(run = run_id.as_str(), error = %e, "could not mark run failed")
                }
            }
        }
        result
    }

    async fn drive(
        &mut self,
        run_id: &RunId,
        pipeline: &PipelineVersion,
        plan: &Plan,
    ) -> Result<RunStatus, SchedulerError> {
        if self.store.get_run(run_id).await?.status == RunStatus::Queued {
            self.store
                .set_run_status(run_id, RunStatus::Running, &now())
                .await?;
        }
        let mut done = self.reconcile(run_id).await?;
        if let Some(operator) = self.gate.clone() {
            let gate = Step {
                node_id: GATE_NODE.to_owned(),
                operator,
                implementation_digest: String::new(),
                params: serde_json::Map::new(),
                inputs: vec![],
            };
            let attempt = match done.get(GATE_NODE) {
                Some(attempt) => attempt.clone(),
                None => match self
                    .run_step(run_id, &gate, &done, Inputs::Gate(pipeline, plan))
                    .await?
                {
                    Some(attempt) => attempt,
                    None => return self.finish(run_id, RunStatus::Failed).await,
                },
            };
            if self.gate_failed(&attempt).await? {
                return self.finish(run_id, RunStatus::Failed).await;
            }
            done.insert(GATE_NODE.to_owned(), attempt);
        }
        loop {
            let succeeded: HashSet<String> = done.keys().cloned().collect();
            // The gate is not a plan step; `succeeded` only needs plan nodes.
            let step = match next_step(plan, &succeeded) {
                Next::Done => return self.finish(run_id, RunStatus::Succeeded).await,
                Next::Run(step) => step,
            };
            match self.run_step(run_id, step, &done, Inputs::Upstream).await? {
                Some(attempt) => {
                    done.insert(step.node_id.clone(), attempt);
                }
                None => return self.finish(run_id, RunStatus::Failed).await,
            }
        }
    }

    /// True when any methodology check in the gate's `checks` output failed.
    async fn gate_failed(&self, attempt: &AttemptId) -> Result<bool, SchedulerError> {
        let outputs = self.store.outputs(attempt).await?;
        let (_, artifact) = outputs
            .iter()
            .find(|(port, _)| port == "checks")
            .ok_or_else(|| SchedulerError::GateOutput("no checks output".into()))?;
        let bytes = self.artifacts.get(artifact.content_hash.as_str()).await?;
        let text =
            std::str::from_utf8(&bytes).map_err(|e| SchedulerError::GateOutput(e.to_string()))?;
        let checks: Vec<MethodologyCheck> =
            parse(text).map_err(|e| SchedulerError::GateOutput(e.to_string()))?;
        let failed: Vec<_> = checks
            .iter()
            .filter(|c| c.verdict == Verdict::Fail)
            .collect();
        for check in &failed {
            tracing::info!(
                check = check.check.as_str(),
                rationale = check.rationale.as_str(),
                "methodology check failed"
            );
        }
        Ok(!failed.is_empty())
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
                AttemptState::Succeeded | AttemptState::CacheHit => {
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
        inputs: Inputs<'_>,
    ) -> Result<Option<AttemptId>, SchedulerError> {
        let previous = self
            .store
            .list_attempts(run_id)
            .await?
            .iter()
            .filter(|a| a.node_id.as_str() == step.node_id)
            .count() as u64;
        // Side-effecting steps get one attempt ever, even across reruns (arch doc §9).
        let cap = if step.operator.effects == Effects::SideEffecting {
            1
        } else {
            self.settings.max_attempts
        };
        // The step's definition key: always known for upstream steps; only pure steps share it
        // through the global cache, but any step can reuse an edited run's result (ADR-0026).
        let key = match inputs {
            Inputs::Upstream if step.operator.effects != Effects::SideEffecting => {
                let hashes: Vec<(String, String)> = self
                    .resolve_inputs(step, done)
                    .await?
                    .into_iter()
                    .map(|(port, artifact)| (port, artifact.content_hash.to_string()))
                    .collect();
                let project = self.store.get_run(run_id).await?.project_id;
                Some(cache_key(project.as_str(), step, &hashes))
            }
            _ => None,
        };
        let source = match (&key, &self.reuse) {
            (Some(key), _) if cacheable(step) => self.store.cached_attempt(key).await?,
            (Some(key), Some(reuse)) => {
                self.store
                    .reusable_attempt(reuse, &step.node_id, key)
                    .await?
            }
            _ => None,
        };
        if let Some(source) = source {
            let attempt = self.cache_hit(run_id, step, previous + 1, &source).await?;
            if let Some(key) = &key {
                self.store.record_step_key(&attempt, key).await?;
            }
            return Ok(Some(attempt));
        }
        let shared_key = key.as_deref().filter(|_| cacheable(step));
        for number in previous + 1..=cap {
            let worker = match self.worker.take() {
                Some(worker) => worker,
                None => match self.workers.spawn().await {
                    Ok(worker) => worker,
                    Err(e) => return Err(e.into()),
                },
            };
            let attempt = self.new_attempt(run_id, step, number).await?;
            match self
                .try_attempt(step, &attempt, done, inputs, shared_key, worker)
                .await?
            {
                End::Succeeded => {
                    if let Some(key) = &key {
                        self.store.record_step_key(&attempt.id, key).await?;
                    }
                    return Ok(Some(attempt.id));
                }
                End::Permanent => return Ok(None),
                End::Retryable => {}
            }
        }
        Ok(None)
    }

    /// A new attempt that reuses `source`'s outputs instead of running (arch §9).
    async fn cache_hit(
        &self,
        run_id: &RunId,
        step: &Step,
        number: u64,
        source: &AttemptId,
    ) -> Result<AttemptId, SchedulerError> {
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
        self.store.hit_cache(&attempt.id, source, &now()).await?;
        Ok(attempt.id)
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

    /// Lease one attempt to `worker` and follow it to the end. The worker is kept for the
    /// next attempt only when this one succeeded; after any failure its state is unknown.
    async fn try_attempt(
        &mut self,
        step: &Step,
        attempt: &Attempt,
        done: &HashMap<String, AttemptId>,
        inputs: Inputs<'_>,
        cache_key: Option<&str>,
        mut worker: W::Worker,
    ) -> Result<End, SchedulerError> {
        let id = &attempt.id;
        let run_id = &attempt.run_id;
        let lease = self.lease_message(run_id, step, id, done, inputs).await?;
        self.store
            .lease_attempt(id, worker.id(), &self.expiry()?, &now())
            .await?;
        if let Err(e) = worker.send(&lease).await {
            return self
                .lost(
                    step,
                    id,
                    AttemptState::Failed,
                    "worker_lost",
                    &e.to_string(),
                )
                .await;
        }
        self.store
            .transition_attempt(id, AttemptState::Running, &now())
            .await?;

        // Only heartbeats renew the lease; other traffic does not.
        let mut deadline = Instant::now() + self.settings.lease;
        let mut manifests: Vec<ArtifactManifest> = Vec::new();
        loop {
            let message = match tokio::time::timeout_at(deadline, worker.recv()).await {
                Err(_) => {
                    let reason = "no heartbeat before the lease expired";
                    return self
                        .lost(step, id, AttemptState::TimedOut, "lease_expired", reason)
                        .await;
                }
                Ok(Err(e)) => {
                    return self
                        .lost(
                            step,
                            id,
                            AttemptState::Failed,
                            "worker_lost",
                            &e.to_string(),
                        )
                        .await;
                }
                Ok(Ok(message)) => message,
            };
            match message {
                WorkerMessage::Heartbeat(m) if &m.attempt_id == id => {
                    deadline = Instant::now() + self.settings.lease;
                    self.store.extend_lease(id, &self.expiry()?).await?;
                }
                WorkerMessage::Progress(m) if &m.attempt_id == id => {}
                WorkerMessage::ArtifactManifest(m) if &m.attempt_id == id => manifests.push(m),
                WorkerMessage::Fail(m) if &m.attempt_id == id => {
                    self.store
                        .fail_attempt(id, AttemptState::Failed, &m.error, &now())
                        .await?;
                    // It reported the failure itself, so it is healthy: keep it.
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
                    let end = self
                        .commit(run_id, step, attempt, &manifests, cache_key)
                        .await?;
                    // The ack is a courtesy; a worker that cannot take it is simply not reused.
                    if matches!(end, End::Succeeded) && worker.send(&ack(id)?).await.is_ok() {
                        self.worker = Some(worker);
                    }
                    return Ok(end);
                }
                other => {
                    // A late message for an older attempt, or one a worker must never send.
                    tracing::warn!(attempt = id.as_str(), message = ?other, "ignored worker message");
                }
            }
        }
    }

    /// The worker went away or went silent: record why and drop it.
    async fn lost(
        &self,
        step: &Step,
        id: &AttemptId,
        to: AttemptState,
        code: &str,
        reason: &str,
    ) -> Result<End, SchedulerError> {
        self.store
            .fail_attempt(id, to, &error(code, reason)?, &now())
            .await?;
        Ok(self.retryable(step))
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
        cache_key: Option<&str>,
    ) -> Result<End, SchedulerError> {
        let id = &attempt.id;
        let mut declared: Vec<String> = step
            .operator
            .outputs
            .iter()
            .map(|p| p.name.to_string())
            .collect();
        declared.sort();
        // Any step may also send what it printed (ADR-0025); every other port must be declared.
        let mut sent: Vec<String> = manifests
            .iter()
            .map(|m| m.port.to_string())
            .filter(|p| p != CONSOLE_PORT)
            .collect();
        sent.sort();
        if declared != sent {
            let reason = format!("outputs {sent:?} do not match declared ports {declared:?}");
            return self.reject(id, &reason).await;
        }
        let project_id = self.store.get_run(run_id).await?.project_id;
        let staging = self.artifacts.staging_dir(id.as_str())?;
        let mut outputs = Vec::new();
        for m in manifests {
            let Some(staged) = local_path(m.staging_uri.as_str()) else {
                let reason = format!("unsupported staging uri {}", m.staging_uri.as_str());
                return self.reject(id, &reason).await;
            };
            // Only this attempt's own staging directory; never another attempt's files.
            if !staged.starts_with(&staging) || staged.components().any(|c| c.as_os_str() == "..") {
                let reason = format!("{} is outside {}", staged.display(), staging.display());
                return self.reject(id, &reason).await;
            }
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
            outputs.push((m.port.to_string(), build("artifact", artifact)?));
        }
        // Every object is promoted before any row is written (promote, then DB commit).
        self.store
            .succeed_attempt(id, &outputs, cache_key, &now())
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
        source: Inputs<'_>,
    ) -> Result<WorkerMessage, SchedulerError> {
        let mut inputs = match source {
            Inputs::Upstream => Vec::new(),
            Inputs::Gate(pipeline, plan) => {
                self.gate_inputs(run_id, attempt, pipeline, plan).await?
            }
        };
        for (port, artifact) in self.resolve_inputs(step, done).await? {
            inputs.push(json!({
                "port": port,
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

    /// Each input port's artifact, from the upstream attempt that produced it. Sorted by port.
    async fn resolve_inputs(
        &self,
        step: &Step,
        done: &HashMap<String, AttemptId>,
    ) -> Result<Vec<(String, Artifact)>, SchedulerError> {
        let mut resolved = Vec::new();
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
            resolved.push((input.port.clone(), artifact));
        }
        Ok(resolved)
    }

    /// Commit the pipeline version and its operators as the gate attempt's input artifacts.
    async fn gate_inputs(
        &self,
        run_id: &RunId,
        attempt: &AttemptId,
        pipeline: &PipelineVersion,
        plan: &Plan,
    ) -> Result<Vec<serde_json::Value>, SchedulerError> {
        let mut operators: Vec<&Operator> = plan.steps.iter().map(|s| &s.operator).collect();
        operators.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
        operators.dedup_by(|a, b| a.id == b.id);
        let docs = [
            ("operators", json!(operators)),
            ("pipeline", json!(pipeline)),
        ];
        let dir = self
            .artifacts
            .staging_dir(&format!("{}_inputs", attempt.as_str()))?;
        std::fs::create_dir_all(&dir)?;
        let project_id = self.store.get_run(run_id).await?.project_id;
        let mut bindings = Vec::new();
        for (port, doc) in docs {
            let bytes = doc.to_string();
            let path = dir.join(format!("{port}.json"));
            std::fs::write(&path, &bytes)?;
            let hash = sprisk_artifacts::content_hash(bytes.as_bytes());
            let committed = self.artifacts.commit(&path, &hash).await?;
            let artifact: sprisk_contracts::Artifact = build(
                "artifact",
                json!({
                    "schema_version": "sprisk.artifact/v1",
                    "id": format!("art_{}", ulid::Ulid::new()),
                    "project_id": project_id,
                    "producer_attempt_id": attempt,
                    "content_hash": committed.content_hash,
                    "media_type": "application/json",
                    "size_bytes": committed.size_bytes,
                    "uri": committed.uri,
                    "created_at": now(),
                }),
            )?;
            self.store.insert_artifact(&artifact).await?;
            bindings.push(json!({
                "port": port,
                "artifact_id": artifact.id,
                "uri": artifact.uri,
                "content_hash": artifact.content_hash,
            }));
        }
        Ok(bindings)
    }

    fn expiry(&self) -> Result<sprisk_contracts::Timestamp, SchedulerError> {
        let at = jiff::Timestamp::now() + self.settings.lease;
        build("timestamp", json!(sprisk_core::time::format(at)))
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

use sprisk_core::time::now;
