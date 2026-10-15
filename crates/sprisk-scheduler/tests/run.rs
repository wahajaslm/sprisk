#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::json;
use sprisk_artifacts::ArtifactStore;
use sprisk_contracts::{
    AttemptState, LeaseAttempt, PipelineVersion, Run, RunStatus, WorkerId, WorkerMessage, parse,
};
use sprisk_graph::{Plan, compile};
use sprisk_registry::Registry;
use sprisk_scheduler::{Scheduler, Settings, Worker, WorkerError, Workers};
use sprisk_store::SqliteStore;

const RUN: &str = "run_01JABCDEFGHJKMNPQRSTVWXYZ0";

/// What the fake worker does when leased one attempt of a node.
#[derive(Clone, Copy, Debug)]
enum Behave {
    Succeed,
    FailTransient,
    FailPermanent,
    Silent,
    Crash,
    BadHash,
}

/// node id -> behaviour per attempt number (1-based); missing entries succeed.
type Script = HashMap<&'static str, Vec<Behave>>;

#[derive(Default)]
struct Log {
    spawned: usize,
    leases: Vec<LeaseAttempt>,
}

struct FakeWorkers {
    script: Script,
    log: Arc<Mutex<Log>>,
}

struct FakeWorker {
    id: WorkerId,
    script: Script,
    log: Arc<Mutex<Log>>,
    replies: VecDeque<Result<WorkerMessage, WorkerError>>,
}

impl Workers for FakeWorkers {
    type Worker = FakeWorker;
    async fn spawn(&mut self) -> Result<FakeWorker, WorkerError> {
        let mut log = self.log.lock().unwrap();
        log.spawned += 1;
        Ok(FakeWorker {
            id: format!("wrk_01JABCDEFGHJKMNPQRSTVWXYZ{}", log.spawned)
                .parse()
                .unwrap(),
            script: self.script.clone(),
            log: self.log.clone(),
            replies: VecDeque::new(),
        })
    }
}

impl Worker for FakeWorker {
    fn id(&self) -> &WorkerId {
        &self.id
    }

    async fn send(&mut self, message: &WorkerMessage) -> Result<(), WorkerError> {
        let WorkerMessage::LeaseAttempt(lease) = message else {
            return Ok(());
        };
        let tries = {
            let mut log = self.log.lock().unwrap();
            log.leases.push(lease.clone());
            log.leases
                .iter()
                .filter(|l| l.node_id == lease.node_id)
                .count()
        };
        let node = lease.node_id.as_str().to_owned();
        let behave = self
            .script
            .get(node.as_str())
            .and_then(|b| b.get(tries - 1).copied())
            .unwrap_or(Behave::Succeed);
        self.replies = replies(lease, behave);
        Ok(())
    }

    async fn recv(&mut self) -> Result<WorkerMessage, WorkerError> {
        match self.replies.pop_front() {
            Some(reply) => reply,
            None => std::future::pending().await,
        }
    }
}

fn msg(value: serde_json::Value) -> Result<WorkerMessage, WorkerError> {
    Ok(parse(&value.to_string()).unwrap())
}

fn replies(lease: &LeaseAttempt, behave: Behave) -> VecDeque<Result<WorkerMessage, WorkerError>> {
    let attempt = lease.attempt_id.as_str().to_owned();
    let fail = |kind: &str| {
        msg(
            json!({"type": "fail", "attempt_id": attempt, "failure_kind": kind,
                   "error": {"code": "boom", "message": "boom"}}),
        )
    };
    match behave {
        Behave::FailTransient => [fail("transient")].into(),
        Behave::FailPermanent => [fail("permanent")].into(),
        Behave::Silent => [msg(json!({"type": "heartbeat", "attempt_id": attempt}))].into(),
        Behave::Crash => [Err(WorkerError::Exited)].into(),
        Behave::Succeed | Behave::BadHash => {
            let staging = url::Url::parse(&lease.staging_uri)
                .unwrap()
                .to_file_path()
                .unwrap();
            std::fs::create_dir_all(&staging).unwrap();
            let mut out: VecDeque<_> = outputs_of(lease.operator.as_str())
                .iter()
                .map(|port| {
                    let path = staging.join(port);
                    let bytes = format!("{} {port}", lease.node_id.as_str());
                    std::fs::write(&path, &bytes).unwrap();
                    let hash = if matches!(behave, Behave::BadHash) {
                        format!("sha256:{}", "0".repeat(64))
                    } else {
                        sha256(bytes.as_bytes())
                    };
                    msg(
                        json!({"type": "artifact_manifest", "attempt_id": attempt, "port": port,
                               "staging_uri": url::Url::from_file_path(&path).unwrap().to_string(),
                               "content_hash": hash, "media_type": "application/octet-stream",
                               "size_bytes": bytes.len()}),
                    )
                })
                .collect();
            out.push_front(msg(json!({"type": "heartbeat", "attempt_id": attempt})));
            out.push_back(msg(json!({"type": "complete", "attempt_id": attempt})));
            out
        }
    }
}

fn sha256(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("sha256:{:x}", sha2::Sha256::digest(bytes))
}

fn outputs_of(operator: &str) -> &'static [&'static str] {
    match operator.split('@').next().unwrap() {
        "sprisk.io.file_source" => &["data"],
        "sprisk.validation.random_split" => &["train", "test"],
        "sprisk.ml.linear_model" | "sprisk.ml.dummy_baseline" => &["model"],
        "sprisk.ml.evaluate" => &["metrics"],
        other => panic!("no fake outputs for {other}"),
    }
}

fn plugins() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins")
}

fn plan() -> Plan {
    let pipeline: PipelineVersion = parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                {"id": "load", "operator": "sprisk.io.file_source@1.0.0",
                 "params": {"path": "/data/d.csv", "format": "csv"}},
                {"id": "split", "operator": "sprisk.validation.random_split@1.0.0",
                 "params": {"test_fraction": 0.2, "seed": 1}},
                {"id": "model", "operator": "sprisk.ml.linear_model@1.0.0",
                 "params": {"target": "y", "features": ["x"], "task": "regression"}},
                {"id": "score", "operator": "sprisk.ml.evaluate@1.0.0",
                 "params": {"target": "y", "task": "regression"}}
            ],
            "edges": [
                {"from": "load.data", "to": "split.data"},
                {"from": "split.train", "to": "model.train"},
                {"from": "model.model", "to": "score.model"},
                {"from": "split.test", "to": "score.test"}
            ],
            "created_at": "2026-10-16T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap();
    compile(&pipeline, &Registry::load_dir(&plugins()).unwrap()).unwrap()
}

struct Env {
    _dir: tempfile::TempDir,
    store: SqliteStore,
    artifacts: ArtifactStore,
    log: Arc<Mutex<Log>>,
}

async fn run_with(script: Script) -> (Env, RunStatus) {
    run_with_settings(script, Settings::default()).await
}

async fn run_with_settings(script: Script, settings: Settings) -> (Env, RunStatus) {
    let dir = tempfile::tempdir().unwrap();
    let store = SqliteStore::in_memory().await.unwrap();
    let run: Run = parse(
        &json!({"schema_version": "sprisk.run/v1", "id": RUN,
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "status": "queued", "created_at": "2026-10-16T10:00:00Z"})
        .to_string(),
    )
    .unwrap();
    store.insert_run(&run).await.unwrap();
    let artifacts = ArtifactStore::local(dir.path()).unwrap();
    let log = Arc::new(Mutex::new(Log::default()));
    let workers = FakeWorkers {
        script,
        log: log.clone(),
    };
    let status = Scheduler::new(&store, &artifacts, workers, settings)
        .run(&run.id, &plan())
        .await
        .unwrap();
    (
        Env {
            _dir: dir,
            store,
            artifacts,
            log,
        },
        status,
    )
}

async fn states(env: &Env, node: &str) -> Vec<AttemptState> {
    env.store
        .list_attempts(&RUN.parse().unwrap())
        .await
        .unwrap()
        .into_iter()
        .filter(|a| a.node_id.as_str() == node)
        .map(|a| a.state)
        .collect()
}

#[tokio::test]
async fn happy_path_runs_every_step_and_commits_outputs() {
    let (env, status) = run_with(Script::new()).await;
    assert_eq!(status, RunStatus::Succeeded);
    for node in ["load", "split", "model", "score"] {
        assert_eq!(
            states(&env, node).await,
            vec![AttemptState::Succeeded],
            "{node}"
        );
    }
    let run = env.store.get_run(&RUN.parse().unwrap()).await.unwrap();
    assert_eq!(run.status, RunStatus::Succeeded);
    assert!(run.finished_at.is_some());
    assert_eq!(env.log.lock().unwrap().spawned, 1, "one worker reused");
}

#[tokio::test]
async fn downstream_lease_carries_upstream_artifacts_and_its_own_staging_dir() {
    let (env, _) = run_with(Script::new()).await;
    let log = env.log.lock().unwrap();
    let score = log
        .leases
        .iter()
        .find(|l| l.node_id.as_str() == "score")
        .unwrap();
    let ports: Vec<_> = score
        .inputs
        .iter()
        .map(|i| i.port.as_str().to_owned())
        .collect();
    assert_eq!(ports, ["model", "test"]);
    let test_input = &score.inputs[1];
    let bytes = std::fs::read(
        url::Url::parse(&test_input.uri)
            .unwrap()
            .to_file_path()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(bytes, b"split test");
    assert_eq!(
        test_input.content_hash.as_str().to_owned(),
        sha256(b"split test")
    );
    assert!(
        score
            .staging_uri
            .ends_with(&format!("{}/", score.attempt_id.as_str()))
    );
    drop(env.artifacts);
}

#[tokio::test]
async fn transient_failure_is_retried_as_a_new_attempt() {
    let (env, status) = run_with([("split", vec![Behave::FailTransient])].into()).await;
    assert_eq!(status, RunStatus::Succeeded);
    assert_eq!(
        states(&env, "split").await,
        vec![AttemptState::Failed, AttemptState::Succeeded]
    );
}

#[tokio::test]
async fn permanent_failure_fails_the_run_without_retry() {
    let (env, status) = run_with([("split", vec![Behave::FailPermanent])].into()).await;
    assert_eq!(status, RunStatus::Failed);
    assert_eq!(states(&env, "split").await, vec![AttemptState::Failed]);
    assert!(
        states(&env, "model").await.is_empty(),
        "downstream never starts"
    );
    let attempts = env
        .store
        .list_attempts(&RUN.parse().unwrap())
        .await
        .unwrap();
    let failed = attempts
        .iter()
        .find(|a| a.node_id.as_str() == "split")
        .unwrap();
    assert_eq!(failed.error.as_ref().unwrap().code.as_str(), "boom");
}

#[tokio::test]
async fn silent_worker_times_out_and_a_new_worker_retries() {
    // A short lease keeps the test fast; the silent worker never answers.
    let settings = Settings {
        lease: std::time::Duration::from_millis(50),
        ..Settings::default()
    };
    let (env, status) = run_with_settings([("model", vec![Behave::Silent])].into(), settings).await;
    assert_eq!(status, RunStatus::Succeeded);
    assert_eq!(
        states(&env, "model").await,
        vec![AttemptState::TimedOut, AttemptState::Succeeded]
    );
    assert_eq!(env.log.lock().unwrap().spawned, 2);
}

#[tokio::test]
async fn crashed_worker_is_replaced_and_the_step_retried() {
    let (env, status) = run_with([("load", vec![Behave::Crash])].into()).await;
    assert_eq!(status, RunStatus::Succeeded);
    assert_eq!(
        states(&env, "load").await,
        vec![AttemptState::Failed, AttemptState::Succeeded]
    );
    assert_eq!(env.log.lock().unwrap().spawned, 2);
}

#[tokio::test]
async fn retries_stop_at_the_cap() {
    let transient = vec![Behave::FailTransient; 5];
    let (env, status) = run_with([("load", transient)].into()).await;
    assert_eq!(status, RunStatus::Failed);
    assert_eq!(states(&env, "load").await, vec![AttemptState::Failed; 3]);
}

#[tokio::test]
async fn manifest_with_wrong_hash_fails_permanently_and_commits_nothing() {
    let (env, status) = run_with([("load", vec![Behave::BadHash])].into()).await;
    assert_eq!(status, RunStatus::Failed);
    assert_eq!(states(&env, "load").await, vec![AttemptState::Failed]);
    let attempts = env
        .store
        .list_attempts(&RUN.parse().unwrap())
        .await
        .unwrap();
    assert!(env.store.outputs(&attempts[0].id).await.unwrap().is_empty());
}

#[tokio::test]
async fn attempt_left_in_flight_by_a_crashed_control_plane_times_out_and_is_retried() {
    let dir = tempfile::tempdir().unwrap();
    let store = SqliteStore::in_memory().await.unwrap();
    let run: Run = parse(
        &json!({"schema_version": "sprisk.run/v1", "id": RUN,
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "status": "running", "created_at": "2026-10-16T10:00:00Z"})
        .to_string(),
    )
    .unwrap();
    store.insert_run(&run).await.unwrap();
    let stuck: sprisk_contracts::Attempt = parse(
        &json!({"schema_version": "sprisk.attempt/v1", "id": "att_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "run_id": RUN, "node_id": "load", "number": 1, "state": "queued",
                "created_at": "2026-10-16T10:00:00Z"})
        .to_string(),
    )
    .unwrap();
    store.insert_attempt(&stuck).await.unwrap();
    let worker = "wrk_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    let t = "2026-10-16T10:00:01Z";
    store
        .lease_attempt(&stuck.id, &worker, &t.parse().unwrap(), t)
        .await
        .unwrap();

    let artifacts = ArtifactStore::local(dir.path()).unwrap();
    let workers = FakeWorkers {
        script: Script::new(),
        log: Arc::default(),
    };
    let status = Scheduler::new(&store, &artifacts, workers, Settings::default())
        .run(&run.id, &plan())
        .await
        .unwrap();

    assert_eq!(status, RunStatus::Succeeded);
    let load: Vec<_> = store
        .list_attempts(&run.id)
        .await
        .unwrap()
        .into_iter()
        .filter(|a| a.node_id.as_str() == "load")
        .map(|a| (a.number.get(), a.state))
        .collect();
    assert_eq!(
        load,
        [(1, AttemptState::TimedOut), (2, AttemptState::Succeeded)]
    );
}
