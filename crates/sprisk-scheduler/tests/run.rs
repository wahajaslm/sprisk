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
    /// Sends progress forever, never a heartbeat.
    Chatter,
    WrongPort,
    RemoteUri,
    /// Points its manifest at a file in another attempt's staging directory.
    Escape,
    /// Gate B attempt that reports a failing methodology check.
    GateFail,
    /// Gate B attempt whose checks output is not a MethodologyCheck array.
    GateGarbage,
    /// Also writes evidence that matches what `producer_load` declares.
    GoodEvidence,
    /// Also writes evidence whose field has another type than declared.
    BadEvidence,
}

/// node id -> behaviour per attempt number (1-based); missing entries succeed.
type Script = HashMap<&'static str, Vec<Behave>>;

#[derive(Default)]
struct Log {
    spawned: usize,
    released: usize,
    leases: Vec<LeaseAttempt>,
}

#[derive(Default)]
struct FakeWorkers {
    script: Script,
    log: Arc<Mutex<Log>>,
    fail_spawn: bool,
    /// Node whose lease cannot be delivered (the worker died before reading it).
    fail_send: Option<&'static str>,
}

struct FakeWorker {
    id: WorkerId,
    script: Script,
    fail_send: Option<&'static str>,
    chatter: Option<String>,
    log: Arc<Mutex<Log>>,
    replies: VecDeque<Result<WorkerMessage, WorkerError>>,
}

impl Workers for FakeWorkers {
    type Worker = FakeWorker;
    async fn spawn(&mut self) -> Result<FakeWorker, WorkerError> {
        if self.fail_spawn {
            return Err(WorkerError::Spawn(std::io::Error::other("no python")));
        }
        let mut log = self.log.lock().unwrap();
        log.spawned += 1;
        Ok(FakeWorker {
            id: format!("wrk_01JABCDEFGHJKMNPQRSTVWXYZ{}", log.spawned)
                .parse()
                .unwrap(),
            script: self.script.clone(),
            fail_send: self.fail_send.take(),
            chatter: None,
            log: self.log.clone(),
            replies: VecDeque::new(),
        })
    }

    fn release(&mut self, _worker: FakeWorker) {
        self.log.lock().unwrap().released += 1;
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
        if self.fail_send == Some(lease.node_id.as_str()) {
            self.fail_send = None;
            return Err(WorkerError::Exited);
        }
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
        self.chatter =
            matches!(behave, Behave::Chatter).then(|| lease.attempt_id.as_str().to_owned());
        self.replies = replies(lease, behave);
        Ok(())
    }

    async fn recv(&mut self) -> Result<WorkerMessage, WorkerError> {
        if let Some(attempt) = &self.chatter {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            return msg(
                json!({"type": "progress", "attempt_id": attempt, "completed": 1, "total": 2}),
            );
        }
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
        Behave::Chatter => VecDeque::new(),
        _ => {
            let staging = url::Url::parse(&lease.staging_uri)
                .unwrap()
                .to_file_path()
                .unwrap();
            std::fs::create_dir_all(&staging).unwrap();
            let mut out: VecDeque<_> = outputs_of(lease.operator.as_str())
                .iter()
                .map(|port| {
                    let path = if matches!(behave, Behave::Escape) {
                        let other = staging.parent().unwrap().join("att_other");
                        std::fs::create_dir_all(&other).unwrap();
                        other.join(port)
                    } else {
                        staging.join(port)
                    };
                    let bytes = if matches!(behave, Behave::GateGarbage) {
                        "not json".to_owned()
                    } else if lease.node_id.as_str().starts_with("gate_") {
                        let verdict = if matches!(behave, Behave::GateFail) {
                            "fail"
                        } else {
                            "pass"
                        };
                        json!([{"schema_version": "sprisk.methodology_check/v1",
                                "id": "mck_01JABCDEFGHJKMNPQRSTVWXYZ0",
                                "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                                "check": "supervised.split_leakage@1.0.0", "verdict": verdict,
                                "rationale": "fake", "cited_nodes": ["split"],
                                "created_at": "2026-10-16T10:00:00Z"}])
                        .to_string()
                    } else {
                        // Params change the bytes, as they would for a real operator.
                        format!("{} {port} {}", lease.node_id.as_str(), json!(lease.params))
                    };
                    std::fs::write(&path, &bytes).unwrap();
                    let hash = if matches!(behave, Behave::BadHash) {
                        format!("sha256:{}", "0".repeat(64))
                    } else {
                        sha256(bytes.as_bytes())
                    };
                    let port = if matches!(behave, Behave::WrongPort) {
                        "extra"
                    } else {
                        port
                    };
                    let uri = if matches!(behave, Behave::RemoteUri) {
                        format!("s3://bucket/{port}")
                    } else {
                        url::Url::from_file_path(&path).unwrap().to_string()
                    };
                    msg(
                        json!({"type": "artifact_manifest", "attempt_id": attempt, "port": port,
                               "staging_uri": uri,
                               "content_hash": hash, "media_type": "application/octet-stream",
                               "size_bytes": bytes.len()}),
                    )
                })
                .collect();
            if let Some(rows) = match behave {
                Behave::GoodEvidence => Some(json!(120)),
                Behave::BadEvidence => Some(json!("many")),
                _ => None,
            } {
                let bytes = json!({ "data.rows": { "rows": rows } }).to_string();
                let path = staging.join("evidence");
                std::fs::write(&path, &bytes).unwrap();
                out.push_back(msg(json!({"type": "artifact_manifest", "attempt_id": attempt,
                    "port": "evidence", "staging_uri": url::Url::from_file_path(&path).unwrap().to_string(),
                    "content_hash": sha256(bytes.as_bytes()), "media_type": "application/json",
                    "size_bytes": bytes.len()})));
            }
            out.push_front(msg(json!({"type": "heartbeat", "attempt_id": attempt})));
            out.push_back(msg(json!({"type": "complete", "attempt_id": attempt})));
            out
        }
    }
}

fn sha256(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("sha256:{}", hex::encode(sha2::Sha256::digest(bytes)))
}

fn outputs_of(operator: &str) -> &'static [&'static str] {
    match operator.split('@').next().unwrap() {
        // Any step may also send `console` (ADR-0025).
        "sprisk.io.file_source" => &["data", "console"],
        "sprisk.validation.random_split" => &["train", "test"],
        "sprisk.ml.linear_model" | "sprisk.ml.dummy_baseline" => &["model"],
        "sprisk.ml.evaluate" => &["metrics", "figures"],
        "sprisk.methodology.supervised" | "sprisk.methodology.split_rows" => &["checks"],
        other => panic!("no fake outputs for {other}"),
    }
}

fn plugins() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins")
}

fn plan() -> Plan {
    compile(&pipeline(), &Registry::load_dir(&plugins()).unwrap()).unwrap()
}

fn gate_operator() -> sprisk_contracts::Operator {
    let methodology = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology");
    let registry = Registry::load_dir(&methodology).unwrap();
    registry
        .get("sprisk.methodology.supervised@1.0.0")
        .unwrap()
        .clone()
}

fn split_check_operator() -> sprisk_contracts::Operator {
    let methodology = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../methodology");
    Registry::load_dir(&methodology)
        .unwrap()
        .get("sprisk.methodology.split_rows@1.0.0")
        .unwrap()
        .clone()
}

fn pipeline() -> PipelineVersion {
    parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                {"id": "load", "operator": "sprisk.io.file_source@1.0.0",
                 "params": {"path": "/data/d.csv", "format": "csv"}},
                {"id": "split", "operator": "sprisk.validation.random_split@1.0.0",
                 "params": {"test_fraction": 0.2, "seed": 1}},
                {"id": "model", "operator": "sprisk.ml.linear_model@3.0.0",
                 "params": {"target": "y", "features": ["x"], "task": "regression"}},
                {"id": "score", "operator": "sprisk.ml.evaluate@2.1.0",
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
    .unwrap()
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
    let workers = FakeWorkers {
        script,
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        settings,
        ..Case::default()
    })
    .await;
    (env, status.unwrap())
}

fn short_lease() -> Settings {
    Settings {
        lease: std::time::Duration::from_millis(50),
        ..Settings::default()
    }
}

struct Case {
    workers: FakeWorkers,
    settings: Settings,
    /// Attempts already stored: `(node, number, state)`.
    earlier: Vec<(&'static str, u64, &'static str)>,
    side_effecting: Option<&'static str>,
    run_status: &'static str,
    gate: bool,
    /// Check each split's rows after it runs (ADR-0040 runtime).
    split_check: bool,
    /// Run `decided_pipeline()`, whose split was set by a stored methodology decision.
    decided: bool,
    /// A deadline the clock passes after this many reads of it.
    deadline_after: Option<usize>,
    /// The load step's operator also produces `data.rows` evidence (ADR-0063).
    producer_load: bool,
}

impl Default for Case {
    fn default() -> Self {
        Self {
            workers: FakeWorkers::default(),
            settings: Settings::default(),
            earlier: vec![],
            side_effecting: None,
            run_status: "queued",
            gate: false,
            split_check: false,
            decided: false,
            deadline_after: None,
            producer_load: false,
        }
    }
}

async fn setup(case: Case) -> (Env, Result<RunStatus, sprisk_scheduler::SchedulerError>) {
    let Case {
        workers,
        settings,
        earlier,
        side_effecting,
        run_status,
        gate,
        split_check,
        decided,
        deadline_after,
        producer_load,
    } = case;
    let dir = tempfile::tempdir().unwrap();
    let store = SqliteStore::in_memory().await.unwrap();
    let pipeline = if decided {
        seed_decision(&store).await;
        decided_pipeline()
    } else {
        pipeline()
    };
    let run: Run = parse(
        &json!({"schema_version": "sprisk.run/v1", "id": RUN,
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "status": run_status, "created_at": "2026-10-16T10:00:00Z"})
        .to_string(),
    )
    .unwrap();
    store.insert_run(&run).await.unwrap();
    for (i, (node, number, state)) in earlier.iter().enumerate() {
        let attempt: sprisk_contracts::Attempt = parse(
            &json!({"schema_version": "sprisk.attempt/v1",
                    "id": format!("att_01JABCDEFGHJKMNPQRSTVWXY{i:02}"),
                    "run_id": RUN, "node_id": node, "number": number, "state": state,
                    "created_at": "2026-10-16T10:00:00Z"})
            .to_string(),
        )
        .unwrap();
        store.insert_attempt(&attempt).await.unwrap();
    }
    let mut plan = plan();
    if let Some(node) = side_effecting {
        let step = plan.steps.iter_mut().find(|s| s.node_id == node).unwrap();
        step.operator.effects = sprisk_contracts::Effects::SideEffecting;
    }
    if producer_load {
        let step = plan.steps.iter_mut().find(|s| s.node_id == "load").unwrap();
        let mut operator = serde_json::to_value(&step.operator).unwrap();
        operator["outputs"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "name": "evidence", "kind": "report" }));
        operator["produces"] = json!({ "data.rows": { "fields": { "rows": "integer" } } });
        operator["attach"] = json!({ "role": "split", "side": "input" });
        step.operator = parse(&operator.to_string()).unwrap();
    }
    let artifacts = ArtifactStore::local(dir.path()).unwrap();
    let log = workers.log.clone();
    let mut scheduler = Scheduler::new(&store, &artifacts, workers, settings);
    if gate {
        scheduler = scheduler.with_gate(gate_operator());
    }
    if split_check {
        scheduler = scheduler.with_split_check(split_check_operator());
    }
    if let Some(reads) = deadline_after {
        let deadline: jiff::Timestamp = "2026-10-21T10:00:00Z".parse().unwrap();
        let read = std::sync::atomic::AtomicUsize::new(0);
        let clock = move || {
            let n = read.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let second = jiff::SignedDuration::from_secs(1);
            if n < reads {
                deadline - second
            } else {
                deadline + second
            }
        };
        scheduler = scheduler.until(deadline, Arc::new(clock));
    }
    let status = scheduler.run(&run.id, &pipeline, &plan).await;
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
    let load = env
        .store
        .list_attempts(&RUN.parse().unwrap())
        .await
        .unwrap();
    let load = load.iter().find(|a| a.node_id.as_str() == "load").unwrap();
    let ports: Vec<_> = env
        .store
        .outputs(&load.id)
        .await
        .unwrap()
        .into_iter()
        .map(|(p, _)| p)
        .collect();
    assert!(ports.contains(&"console".to_owned()), "{ports:?}");
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
    assert!(
        bytes.starts_with(b"split test "),
        "the upstream split.test bytes"
    );
    assert_eq!(test_input.content_hash.as_str().to_owned(), sha256(&bytes));
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
    let (env, status) =
        run_with_settings([("model", vec![Behave::Silent])].into(), short_lease()).await;
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
    let workers = FakeWorkers::default();
    let status = Scheduler::new(&store, &artifacts, workers, Settings::default())
        .run(&run.id, &pipeline(), &plan())
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

async fn run_status(env: &Env) -> RunStatus {
    env.store
        .get_run(&RUN.parse().unwrap())
        .await
        .unwrap()
        .status
}

#[tokio::test]
async fn progress_without_heartbeats_does_not_keep_the_lease() {
    let (env, status) =
        run_with_settings([("split", vec![Behave::Chatter])].into(), short_lease()).await;
    assert_eq!(status, RunStatus::Succeeded);
    assert_eq!(
        states(&env, "split").await,
        vec![AttemptState::TimedOut, AttemptState::Succeeded]
    );
}

#[tokio::test]
async fn side_effecting_step_is_not_retried_after_a_transient_failure() {
    let workers = FakeWorkers {
        script: [("load", vec![Behave::FailTransient])].into(),
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        side_effecting: Some("load"),
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Failed);
    assert_eq!(states(&env, "load").await, vec![AttemptState::Failed]);
}

#[tokio::test]
async fn side_effecting_step_interrupted_by_a_crash_is_not_rerun() {
    let (env, status) = setup(Case {
        earlier: vec![("load", 1, "running")],
        side_effecting: Some("load"),
        run_status: "running",
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Failed);
    assert_eq!(states(&env, "load").await, vec![AttemptState::TimedOut]);
    assert!(env.log.lock().unwrap().leases.is_empty());
}

#[tokio::test]
async fn rerun_at_the_attempt_cap_starts_no_new_attempt() {
    let (env, status) = setup(Case {
        earlier: vec![
            ("load", 1, "failed"),
            ("load", 2, "failed"),
            ("load", 3, "timed_out"),
        ],
        run_status: "running",
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Failed);
    assert_eq!(states(&env, "load").await.len(), 3);
}

#[tokio::test]
async fn worker_that_cannot_start_fails_the_run_and_leaves_no_queued_attempt() {
    let workers = FakeWorkers {
        fail_spawn: true,
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        ..Case::default()
    })
    .await;
    assert!(status.is_err());
    assert_eq!(run_status(&env).await, RunStatus::Failed);
    assert!(states(&env, "load").await.is_empty());
}

#[tokio::test]
async fn lease_that_cannot_be_delivered_fails_the_attempt_and_retries() {
    let workers = FakeWorkers {
        fail_send: Some("load"),
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Succeeded);
    assert_eq!(
        states(&env, "load").await,
        vec![AttemptState::Failed, AttemptState::Succeeded]
    );
}

#[tokio::test]
async fn bad_manifests_fail_the_attempt_permanently() {
    for behave in [Behave::WrongPort, Behave::RemoteUri, Behave::Escape] {
        let (env, status) = run_with([("load", vec![behave])].into()).await;
        assert_eq!(status, RunStatus::Failed, "{behave:?}");
        assert_eq!(
            states(&env, "load").await,
            vec![AttemptState::Failed],
            "{behave:?}"
        );
    }
}

async fn run_producer(behave: Behave) -> (Env, RunStatus) {
    let workers = FakeWorkers {
        script: [("load", vec![behave])].into(),
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        producer_load: true,
        ..Case::default()
    })
    .await;
    (env, status.unwrap())
}

#[tokio::test]
async fn evidence_matching_its_manifest_is_saved_with_the_step() {
    let (env, status) = run_producer(Behave::GoodEvidence).await;
    assert_eq!(status, RunStatus::Succeeded);
    assert_eq!(states(&env, "load").await, vec![AttemptState::Succeeded]);
}

#[tokio::test]
async fn evidence_that_breaks_its_manifest_fails_the_step_and_saves_nothing() {
    let (env, status) = run_producer(Behave::BadEvidence).await;
    assert_eq!(status, RunStatus::Failed);
    let attempts = env
        .store
        .list_attempts(&RUN.parse().unwrap())
        .await
        .unwrap();
    let load = attempts
        .iter()
        .find(|a| a.node_id.as_str() == "load")
        .unwrap();
    assert_eq!(load.state, AttemptState::Failed);
    let message = load.error.as_ref().unwrap().message.as_str();
    assert!(
        message.contains("data.rows.rows is \"many\", not integer"),
        "{message}"
    );
    assert!(env.store.outputs(&load.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn gate_b_runs_first_with_the_pipeline_its_plan_operators_question_and_decisions_as_inputs() {
    let (env, status) = setup(Case {
        gate: true,
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Succeeded);
    assert_eq!(states(&env, "gate_b").await, vec![AttemptState::Succeeded]);
    let log = env.log.lock().unwrap();
    let gate = &log.leases[0];
    assert_eq!(gate.node_id.as_str(), "gate_b");
    let ports: Vec<_> = gate
        .inputs
        .iter()
        .map(|i| i.port.as_str().to_owned())
        .collect();
    assert_eq!(
        ports,
        ["decisions", "operators", "pipeline", "plan", "question"]
    );
    let sent: PipelineVersion = parse(&gate_input(gate, "pipeline").to_string()).unwrap();
    assert_eq!(sent, pipeline());
    let plan: sprisk_contracts::ExecutionPlan =
        parse(&gate_input(gate, "plan").to_string()).unwrap();
    assert_eq!(plan.pipeline_version_id, sent.id);
    assert_eq!(plan.steps.len(), sent.nodes.len());
    assert_eq!(
        gate_input(gate, "question"),
        json!(null),
        "no question linked"
    );
    assert_eq!(gate_input(gate, "decisions"), json!([]), "no decided node");
}

#[tokio::test]
async fn gate_b_sees_the_linked_question_and_the_decisions_its_nodes_cite() {
    let (env, status) = setup(Case {
        gate: true,
        decided: true,
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Succeeded);
    let log = env.log.lock().unwrap();
    let gate = &log.leases[0];
    assert_eq!(
        gate_input(gate, "question")["id"],
        "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"
    );
    let decisions = gate_input(gate, "decisions");
    let ids: Vec<_> = decisions
        .as_array()
        .unwrap()
        .iter()
        .map(|d| &d["id"])
        .collect();
    assert_eq!(ids, ["mdc_01JABCDEFGHJKMNPQRSTVWXYZ0"]);
}

#[tokio::test]
async fn a_node_citing_a_decision_that_is_not_stored_fails_the_run() {
    let store = SqliteStore::in_memory().await.unwrap();
    store.insert_question_version(&question()).await.unwrap();
    assert_gate_fails_naming(store, "mdc_01JABCDEFGHJKMNPQRSTVWXYZ0").await;
}

#[tokio::test]
async fn a_linked_question_that_is_not_stored_fails_the_run() {
    let store = SqliteStore::in_memory().await.unwrap();
    assert_gate_fails_naming(store, "qv_01JABCDEFGHJKMNPQRSTVWXYZ0").await;
}

/// Running `decided_pipeline()` with a gate on `store` fails the run with an error naming `id`.
async fn assert_gate_fails_naming(store: SqliteStore, id: &str) {
    let dir = tempfile::tempdir().unwrap();
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
    let mut scheduler = Scheduler::new(
        &store,
        &artifacts,
        FakeWorkers::default(),
        Settings::default(),
    )
    .with_gate(gate_operator());

    let result = scheduler.run(&run.id, &decided_pipeline(), &plan()).await;

    let err = result.unwrap_err().to_string();
    assert!(err.contains(id), "{err}");
    assert_eq!(
        store.get_run(&run.id).await.unwrap().status,
        RunStatus::Failed
    );
}

/// The JSON document a gate lease binds to `port`.
fn gate_input(lease: &LeaseAttempt, port: &str) -> serde_json::Value {
    let input = lease
        .inputs
        .iter()
        .find(|i| i.port.as_str() == port)
        .unwrap();
    let path = url::Url::parse(&input.uri).unwrap().to_file_path().unwrap();
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// A shared contract fixture, with some fields replaced so linked records agree on ids.
fn fixture_with<T: serde::de::DeserializeOwned>(
    entity: &str,
    name: &str,
    fields: serde_json::Value,
) -> T {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/contract")
        .join(entity)
        .join("valid")
        .join(name);
    let mut value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    parse(&value.to_string()).unwrap()
}

/// `pipeline()` answering question `qv_..0`, with its split set by decision `mdc_..0`.
fn decided_pipeline() -> PipelineVersion {
    let mut value = serde_json::to_value(pipeline()).unwrap();
    value["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    value["nodes"][1]["methodology_decision_id"] = json!("mdc_01JABCDEFGHJKMNPQRSTVWXYZ0");
    parse(&value.to_string()).unwrap()
}

/// The question `decided_pipeline()` answers.
fn question() -> sprisk_contracts::QuestionVersion {
    fixture_with(
        "question_version",
        "classification-all-fields.json",
        json!({"id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    )
}

/// Store the question, base pipeline, proposal and decision that `decided_pipeline()` cites.
async fn seed_decision(store: &SqliteStore) {
    store.insert_question_version(&question()).await.unwrap();
    store.insert_pipeline_version(&pipeline()).await.unwrap();
    let proposal: sprisk_contracts::DecisionProposal =
        fixture_with("decision_proposal", "split.json", json!({}));
    store.insert_methodology_proposal(&proposal).await.unwrap();
    let applied: PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        json!({"id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1"}),
    );
    let decision: sprisk_contracts::MethodologyDecision =
        fixture_with("methodology_decision", "applied.json", json!({}));
    store
        .apply_methodology_decision(&decision, Some(&applied), "key-0001")
        .await
        .unwrap();
}

#[tokio::test]
async fn failing_methodology_check_stops_the_run_before_any_step() {
    let workers = FakeWorkers {
        script: [("gate_b", vec![Behave::GateFail])].into(),
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        gate: true,
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Failed);
    assert_eq!(states(&env, "gate_b").await, vec![AttemptState::Succeeded]);
    assert!(states(&env, "load").await.is_empty());
}

#[tokio::test]
async fn unreadable_gate_output_fails_the_run_instead_of_leaving_it_running() {
    let workers = FakeWorkers {
        script: [("gate_b", vec![Behave::GateGarbage])].into(),
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        gate: true,
        ..Case::default()
    })
    .await;
    assert!(matches!(
        status,
        Err(sprisk_scheduler::SchedulerError::GateOutput(_))
    ));
    assert_eq!(run_status(&env).await, RunStatus::Failed);
    assert!(states(&env, "load").await.is_empty());
}

const RUN2: &str = "run_01JABCDEFGHJKMNPQRSTVWXYZ2";

/// A first run of `plan()`, then a second run of `plan()` changed by `change`, in one store.
/// Returns the env and the nodes the worker was leased in the second run.
async fn rerun(change: impl FnOnce(&mut Plan)) -> (Env, Vec<String>) {
    rerun_in("prj_01JABCDEFGHJKMNPQRSTVWXYZ0", change).await
}

async fn rerun_in(project: &str, change: impl FnOnce(&mut Plan)) -> (Env, Vec<String>) {
    rerun_with(project, false, None, change).await
}

/// A second run after an edit, reusing the first run's results (ADR-0026).
async fn rerun_reusing(change: impl FnOnce(&mut Plan)) -> (Env, Vec<String>) {
    rerun_with("prj_01JABCDEFGHJKMNPQRSTVWXYZ0", true, None, change).await
}

async fn rerun_with(
    project: &str,
    reuse: bool,
    from: Option<&str>,
    change: impl FnOnce(&mut Plan),
) -> (Env, Vec<String>) {
    let (env, status) = run_with(Script::new()).await;
    assert_eq!(status, RunStatus::Succeeded);
    let run: Run = parse(
        &json!({"schema_version": "sprisk.run/v1", "id": RUN2,
                "project_id": project,
                "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "status": "queued", "created_at": "2026-10-16T10:00:00Z"})
        .to_string(),
    )
    .unwrap();
    env.store.insert_run(&run).await.unwrap();
    let mut plan = plan();
    change(&mut plan);
    let first_leases = env.log.lock().unwrap().leases.len();
    let workers = FakeWorkers {
        log: env.log.clone(),
        ..FakeWorkers::default()
    };
    let mut scheduler = Scheduler::new(&env.store, &env.artifacts, workers, Settings::default());
    if reuse {
        scheduler = scheduler.reusing(RUN.parse().unwrap());
    }
    if let Some(from) = from {
        scheduler = scheduler.running_from(from);
    }
    let status = scheduler.run(&run.id, &pipeline(), &plan).await.unwrap();
    assert_eq!(status, RunStatus::Succeeded);
    let leased = env.log.lock().unwrap().leases[first_leases..]
        .iter()
        .map(|l| l.node_id.to_string())
        .collect();
    (env, leased)
}

async fn states_in(env: &Env, run: &str, node: &str) -> Vec<AttemptState> {
    env.store
        .list_attempts(&run.parse().unwrap())
        .await
        .unwrap()
        .into_iter()
        .filter(|a| a.node_id.as_str() == node)
        .map(|a| a.state)
        .collect()
}

#[tokio::test]
async fn identical_rerun_reuses_pure_steps_and_rereads_the_source() {
    let (env, leased) = rerun(|_| {}).await;

    assert_eq!(leased, ["load"], "a nondeterministic source always runs");
    for node in ["split", "model", "score"] {
        assert_eq!(
            states_in(&env, RUN2, node).await,
            [AttemptState::CacheHit],
            "{node}"
        );
    }
    let first = env
        .store
        .list_attempts(&RUN.parse().unwrap())
        .await
        .unwrap();
    let second = env
        .store
        .list_attempts(&RUN2.parse().unwrap())
        .await
        .unwrap();
    let id_of = |all: &[sprisk_contracts::Attempt], node: &str| {
        all.iter()
            .find(|a| a.node_id.as_str() == node)
            .unwrap()
            .id
            .clone()
    };
    assert_eq!(
        env.store.outputs(&id_of(&second, "model")).await.unwrap(),
        env.store.outputs(&id_of(&first, "model")).await.unwrap(),
        "a cache hit points at the earlier artifacts"
    );
}

#[tokio::test]
async fn changing_one_step_reruns_it_and_its_dependents_only() {
    let (env, leased) = rerun(|plan| {
        let model = plan
            .steps
            .iter_mut()
            .find(|s| s.node_id == "model")
            .unwrap();
        model.params.insert("features".into(), json!(["x", "z"]));
    })
    .await;

    assert_eq!(leased, ["load", "model", "score"]);
    assert_eq!(
        states_in(&env, RUN2, "split").await,
        [AttemptState::CacheHit]
    );
}

#[tokio::test]
async fn a_step_s_own_code_travels_with_its_lease() {
    let (env, leased) = rerun(|plan| {
        let split = plan
            .steps
            .iter_mut()
            .find(|s| s.node_id == "split")
            .unwrap();
        split.code = Some(
            parse(
                &json!({"source": "def split(data):\n    ...\n", "function": "split"}).to_string(),
            )
            .unwrap(),
        );
        split.implementation_digest = "sha256:own".into();
    })
    .await;
    assert!(leased.contains(&"split".to_owned()));
    let log = env.log.lock().unwrap();
    let lease = log
        .leases
        .iter()
        .rev()
        .find(|l| l.node_id.as_str() == "split")
        .unwrap();
    assert_eq!(lease.code.as_ref().unwrap().function.as_str(), "split");
}

#[tokio::test]
async fn a_finished_run_hands_its_worker_back_for_the_next_run() {
    let (env, status) = run_with(Script::new()).await;
    assert_eq!(status, RunStatus::Succeeded);
    let log = env.log.lock().unwrap();
    assert_eq!((log.spawned, log.released), (1, 1));
}

#[tokio::test]
async fn a_worker_that_reported_a_failure_is_kept_for_the_next_run() {
    let (env, status) = run_with([("split", vec![Behave::FailPermanent])].into()).await;
    assert_eq!(status, RunStatus::Failed);
    let log = env.log.lock().unwrap();
    assert_eq!(
        (log.spawned, log.released),
        (1, 1),
        "it answered, so it is healthy"
    );
}

#[tokio::test]
async fn an_edit_reuses_the_earlier_run_up_to_the_edited_step() {
    let (env, leased) = rerun_reusing(|plan| {
        let model = plan
            .steps
            .iter_mut()
            .find(|s| s.node_id == "model")
            .unwrap();
        model.params.insert("features".into(), json!(["x", "z"]));
    })
    .await;

    assert_eq!(leased, ["model", "score"], "the source is not read again");
    assert_eq!(
        states_in(&env, RUN2, "load").await,
        [AttemptState::CacheHit]
    );
}

#[tokio::test]
async fn running_from_a_step_runs_it_and_every_step_after_it_even_unchanged() {
    let (env, leased) = rerun_with(
        "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        true,
        Some("split"),
        |_| {},
    )
    .await;

    assert_eq!(leased, ["split", "model", "score"]);
    assert_eq!(
        states_in(&env, RUN2, "load").await,
        [AttemptState::CacheHit],
        "steps before it are reused"
    );
}

#[tokio::test]
async fn running_from_a_step_skips_the_shared_cache_too() {
    let (_, leased) = rerun_with(
        "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        false,
        Some("model"),
        |_| {},
    )
    .await;
    assert_eq!(
        leased,
        ["load", "model", "score"],
        "load is a source; split comes from the cache"
    );
}

#[tokio::test]
async fn running_from_a_step_the_plan_lacks_is_refused() {
    let (env, status) = run_with(Script::new()).await;
    assert_eq!(status, RunStatus::Succeeded);
    let workers = FakeWorkers {
        log: env.log.clone(),
        ..FakeWorkers::default()
    };
    let refused = Scheduler::new(&env.store, &env.artifacts, workers, Settings::default())
        .running_from("nowhere")
        .run(&RUN.parse().unwrap(), &pipeline(), &plan())
        .await;
    assert!(
        matches!(refused, Err(sprisk_scheduler::SchedulerError::UnknownStartStep(n)) if n == "nowhere")
    );
}

#[tokio::test]
async fn reuse_never_replays_a_side_effecting_step() {
    let (_, leased) = rerun_reusing(|plan| {
        let split = plan
            .steps
            .iter_mut()
            .find(|s| s.node_id == "split")
            .unwrap();
        split.operator.effects = sprisk_contracts::Effects::SideEffecting;
    })
    .await;
    assert!(leased.contains(&"split".to_owned()), "{leased:?}");
}

#[tokio::test]
async fn changed_operator_code_is_not_served_from_cache() {
    let (_, leased) = rerun(|plan| {
        let split = plan
            .steps
            .iter_mut()
            .find(|s| s.node_id == "split")
            .unwrap();
        split.implementation_digest = "sha256:edited".into();
    })
    .await;

    assert_eq!(
        leased,
        ["load", "split"],
        "model and score inputs are unchanged bytes"
    );
}

#[tokio::test]
async fn side_effecting_step_always_runs() {
    let (env, leased) = rerun(|plan| {
        let split = plan
            .steps
            .iter_mut()
            .find(|s| s.node_id == "split")
            .unwrap();
        split.operator.effects = sprisk_contracts::Effects::SideEffecting;
    })
    .await;

    assert!(leased.contains(&"split".to_owned()), "{leased:?}");
    assert_eq!(
        states_in(&env, RUN2, "split").await,
        [AttemptState::Succeeded]
    );
}

#[tokio::test]
async fn another_project_never_reuses_these_results() {
    let (_, leased) = rerun_in("prj_01JABCDEFGHJKMNPQRSTVWXYZ9", |_| {}).await;
    assert_eq!(leased, ["load", "split", "model", "score"]);
}

#[tokio::test]
async fn a_split_s_rows_are_checked_right_after_it_with_the_question() {
    let (env, status) = setup(Case {
        split_check: true,
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Succeeded);
    assert_eq!(
        states(&env, "gate_split").await,
        vec![AttemptState::Succeeded]
    );
    let log = env.log.lock().unwrap();
    let order: Vec<_> = log.leases.iter().map(|l| l.node_id.as_str()).collect();
    let at = |node: &str| order.iter().position(|n| *n == node).unwrap();
    assert!(
        at("split") < at("gate_split") && at("gate_split") < at("model"),
        "{order:?}"
    );
    let check = &log.leases[at("gate_split")];
    assert_eq!(
        check.operator.as_str(),
        "sprisk.methodology.split_rows@1.0.0"
    );
    let ports: Vec<_> = check.inputs.iter().map(|i| i.port.as_str()).collect();
    assert_eq!(ports, ["question", "test", "train"]);
    assert_eq!(gate_input(check, "question"), json!(null));
    assert_eq!(
        json!(check.params),
        json!({"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0", "node_id": "split"})
    );
}

#[tokio::test]
async fn a_failing_split_check_stops_the_run_before_the_next_step() {
    let workers = FakeWorkers {
        script: [("gate_split", vec![Behave::GateFail])].into(),
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        split_check: true,
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Failed);
    assert_eq!(states(&env, "split").await, vec![AttemptState::Succeeded]);
    assert!(states(&env, "model").await.is_empty());
}

#[tokio::test]
async fn a_resumed_run_does_not_skip_the_check_of_a_split_that_finished_before_the_crash() {
    let (env, status) = setup(Case {
        earlier: vec![("load", 1, "succeeded"), ("split", 1, "succeeded")],
        split_check: true,
        ..Case::default()
    })
    .await;
    // The stored split has no rows, so the check it still owes cannot run: a loud error,
    // not a run that goes on unchecked.
    assert!(
        matches!(&status, Err(sprisk_scheduler::SchedulerError::MissingInput { node, .. }) if node == "gate_split"),
        "{status:?}"
    );
    assert!(states(&env, "model").await.is_empty());
}

#[tokio::test]
async fn a_resumed_run_stops_at_a_split_check_that_already_failed() {
    let workers = FakeWorkers {
        script: [("gate_split", vec![Behave::GateFail])].into(),
        ..FakeWorkers::default()
    };
    let (env, status) = setup(Case {
        workers,
        split_check: true,
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Failed);
    // RUN2 is RUN as it stood after a crash between the failing check and the run's end:
    // its finished attempts reuse RUN's outputs.
    let run: Run = parse(
        &json!({"schema_version": "sprisk.run/v1", "id": RUN2,
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "status": "running", "created_at": "2026-10-16T10:00:00Z"})
        .to_string(),
    )
    .unwrap();
    env.store.insert_run(&run).await.unwrap();
    let first = env
        .store
        .list_attempts(&RUN.parse().unwrap())
        .await
        .unwrap();
    for (i, node) in ["load", "split", "gate_split"].iter().enumerate() {
        let source = first.iter().find(|a| a.node_id.as_str() == *node).unwrap();
        let attempt: sprisk_contracts::Attempt = parse(
            &json!({"schema_version": "sprisk.attempt/v1",
                    "id": format!("att_01JABCDEFGHJKMNPQRSTVWXZ{i:02}"),
                    "run_id": RUN2, "node_id": node, "number": 1, "state": "created",
                    "created_at": "2026-10-16T10:00:00Z"})
            .to_string(),
        )
        .unwrap();
        env.store.insert_attempt(&attempt).await.unwrap();
        env.store
            .transition_attempt(&attempt.id, AttemptState::Validated, "2026-10-16T10:00:00Z")
            .await
            .unwrap();
        env.store
            .hit_cache(&attempt.id, &source.id, "2026-10-16T10:00:00Z")
            .await
            .unwrap();
    }
    let first_leases = env.log.lock().unwrap().leases.len();
    let workers = FakeWorkers {
        log: env.log.clone(),
        ..FakeWorkers::default()
    };
    let status = Scheduler::new(&env.store, &env.artifacts, workers, Settings::default())
        .with_split_check(split_check_operator())
        .run(&run.id, &pipeline(), &plan())
        .await
        .unwrap();

    assert_eq!(status, RunStatus::Failed);
    let leased: Vec<_> = env.log.lock().unwrap().leases[first_leases..]
        .iter()
        .map(|l| l.node_id.to_string())
        .collect();
    assert!(leased.is_empty(), "{leased:?}");
}

#[tokio::test]
async fn a_run_past_its_deadline_leases_nothing_and_ends_cancelled() {
    let (env, status) = setup(Case {
        deadline_after: Some(0),
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Cancelled);
    assert!(env.log.lock().unwrap().leases.is_empty());
    let run = env.store.get_run(&RUN.parse().unwrap()).await.unwrap();
    assert_eq!(run.status, RunStatus::Cancelled);
    assert!(run.finished_at.is_some());
}

#[tokio::test]
async fn a_deadline_passed_between_steps_keeps_the_finished_ones_and_starts_no_more() {
    let (env, status) = setup(Case {
        deadline_after: Some(2),
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Cancelled);
    assert_eq!(states(&env, "load").await, vec![AttemptState::Succeeded]);
    assert_eq!(states(&env, "split").await, vec![AttemptState::Succeeded]);
    assert!(states(&env, "model").await.is_empty());
    assert!(states(&env, "score").await.is_empty());
}

#[tokio::test]
async fn a_run_that_finishes_before_its_deadline_succeeds() {
    let (_, status) = setup(Case {
        deadline_after: Some(100),
        ..Case::default()
    })
    .await;
    assert_eq!(status.unwrap(), RunStatus::Succeeded);
}
