#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;
use sprisk_contracts::{Artifact, Attempt, AttemptState, NotebookVersion, Run, RunStatus, parse};
use sprisk_store::{SqliteStore, StoreError};

const NOW: &str = "2026-10-15T10:00:30Z";

/// Reuse the shared contract fixtures as test data.
fn fixture<T: DeserializeOwned>(entity: &str, name: &str) -> T {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/contract")
        .join(entity)
        .join("valid")
        .join(name);
    parse(&fs::read_to_string(path).unwrap()).unwrap()
}

async fn store_with_run() -> (SqliteStore, Run) {
    let store = SqliteStore::in_memory().await.unwrap();
    let run: Run = fixture("run", "running.json");
    store.insert_run(&run).await.unwrap();
    (store, run)
}

#[tokio::test]
async fn run_round_trips() {
    let (store, run) = store_with_run().await;
    assert_eq!(store.get_run(&run.id).await.unwrap(), run);
}

#[tokio::test]
async fn unknown_run_is_not_found() {
    let (store, _) = store_with_run().await;
    let missing = "run_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();
    assert!(matches!(
        store.get_run(&missing).await,
        Err(StoreError::NotFound { .. })
    ));
}

#[tokio::test]
async fn attempts_are_listed_per_run_in_order() {
    let (store, run) = store_with_run().await;
    let first: Attempt = fixture("attempt", "queued.json");
    let mut second = first.clone();
    second.id = "att_01JABCDEFGHJKMNPQRSTVWXYZ1".parse().unwrap();
    second.number = std::num::NonZeroU64::new(2).unwrap();
    store.insert_attempt(&second).await.unwrap();
    store.insert_attempt(&first).await.unwrap();

    let listed = store.list_attempts(&run.id).await.unwrap();

    assert_eq!(listed, vec![first, second]);
}

#[tokio::test]
async fn duplicate_attempt_number_for_a_step_is_rejected() {
    let (store, _) = store_with_run().await;
    let first: Attempt = fixture("attempt", "queued.json");
    let mut clash = first.clone();
    clash.id = "att_01JABCDEFGHJKMNPQRSTVWXYZ1".parse().unwrap();
    store.insert_attempt(&first).await.unwrap();

    let err = store.insert_attempt(&clash).await.unwrap_err();

    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
}

#[tokio::test]
async fn legal_transition_updates_state_and_is_audited() {
    let (store, _) = store_with_run().await;
    let attempt: Attempt = fixture("attempt", "queued.json");
    store.insert_attempt(&attempt).await.unwrap();

    let updated = store
        .transition_attempt(&attempt.id, AttemptState::Leased, NOW)
        .await
        .unwrap();

    assert_eq!(updated.state, AttemptState::Leased);
    assert_eq!(
        store.list_attempts(&attempt.run_id).await.unwrap(),
        vec![updated]
    );
    let events = store.audit_events(attempt.id.as_str()).await.unwrap();
    assert_eq!(
        events,
        vec![(NOW.to_owned(), "attempt.queued->leased".to_owned())]
    );
}

#[tokio::test]
async fn illegal_transition_changes_nothing() {
    let (store, _) = store_with_run().await;
    let attempt: Attempt = fixture("attempt", "queued.json");
    store.insert_attempt(&attempt).await.unwrap();

    let err = store
        .transition_attempt(&attempt.id, AttemptState::Succeeded, NOW)
        .await
        .unwrap_err();

    assert!(matches!(err, StoreError::Transition(_)), "{err}");
    assert_eq!(
        store.list_attempts(&attempt.run_id).await.unwrap(),
        vec![attempt.clone()]
    );
    assert!(
        store
            .audit_events(attempt.id.as_str())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn artifact_round_trips() {
    let (store, _) = store_with_run().await;
    let artifact: Artifact = fixture("artifact", "parquet-with-schema.json");
    store.insert_artifact(&artifact).await.unwrap();
    assert_eq!(store.get_artifact(&artifact.id).await.unwrap(), artifact);
}

const LATER: &str = "2026-10-15T10:01:30Z";

async fn store_with_queued_attempt() -> (SqliteStore, Run, Attempt) {
    let (store, run) = store_with_run().await;
    let attempt: Attempt = fixture("attempt", "queued.json");
    store.insert_attempt(&attempt).await.unwrap();
    (store, run, attempt)
}

#[tokio::test]
async fn lease_sets_worker_and_expiry_with_the_state_change() {
    let (store, _, attempt) = store_with_queued_attempt().await;
    let worker = "wrk_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    let expires = LATER.parse().unwrap();

    let leased = store
        .lease_attempt(&attempt.id, &worker, &expires, NOW)
        .await
        .unwrap();

    assert_eq!(leased.state, AttemptState::Leased);
    assert_eq!(leased.worker_id, Some(worker));
    assert_eq!(leased.lease_expires_at, Some(expires));
    assert_eq!(
        store.list_attempts(&attempt.run_id).await.unwrap(),
        vec![leased]
    );
}

#[tokio::test]
async fn lease_of_an_attempt_that_is_not_queued_is_rejected() {
    let (store, _, attempt) = store_with_queued_attempt().await;
    let worker = "wrk_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    store
        .transition_attempt(&attempt.id, AttemptState::Cancelled, NOW)
        .await
        .unwrap();

    let err = store
        .lease_attempt(&attempt.id, &worker, &LATER.parse().unwrap(), NOW)
        .await
        .unwrap_err();

    assert!(matches!(err, StoreError::Transition(_)), "{err}");
}

#[tokio::test]
async fn extend_lease_moves_expiry_of_a_live_attempt_only() {
    let (store, _, attempt) = store_with_queued_attempt().await;
    let worker = "wrk_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    store
        .lease_attempt(&attempt.id, &worker, &LATER.parse().unwrap(), NOW)
        .await
        .unwrap();
    let much_later = "2026-10-15T10:05:00Z".parse().unwrap();

    let extended = store.extend_lease(&attempt.id, &much_later).await.unwrap();
    assert_eq!(extended.lease_expires_at, Some(much_later.clone()));

    store
        .transition_attempt(&attempt.id, AttemptState::TimedOut, NOW)
        .await
        .unwrap();
    let err = store
        .extend_lease(&attempt.id, &much_later)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::NotLive { .. }), "{err}");
}

async fn uploading_attempt(store: &SqliteStore, attempt: &Attempt) {
    let worker = "wrk_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    store
        .lease_attempt(&attempt.id, &worker, &LATER.parse().unwrap(), NOW)
        .await
        .unwrap();
    for to in [AttemptState::Running, AttemptState::Uploading] {
        store
            .transition_attempt(&attempt.id, to, NOW)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn succeeding_records_outputs_by_port_with_the_state_change() {
    let (store, _, attempt) = store_with_queued_attempt().await;
    uploading_attempt(&store, &attempt).await;
    let mut artifact: Artifact = fixture("artifact", "parquet-with-schema.json");
    artifact.producer_attempt_id = attempt.id.clone();

    let done = store
        .succeed_attempt(
            &attempt.id,
            &[("train".to_owned(), artifact.clone())],
            None,
            LATER,
        )
        .await
        .unwrap();

    assert_eq!(done.state, AttemptState::Succeeded);
    let outputs = store.outputs(&attempt.id).await.unwrap();
    assert_eq!(outputs, vec![("train".to_owned(), artifact.clone())]);
    assert_eq!(store.get_artifact(&artifact.id).await.unwrap(), artifact);
}

#[tokio::test]
async fn succeeding_an_attempt_that_is_not_uploading_records_nothing() {
    let (store, _, attempt) = store_with_queued_attempt().await;
    uploading_attempt(&store, &attempt).await;
    let artifact: Artifact = fixture("artifact", "parquet-with-schema.json");
    let outputs = [("train".to_owned(), artifact.clone())];
    store
        .succeed_attempt(&attempt.id, &outputs, None, LATER)
        .await
        .unwrap();
    let mut other = artifact.clone();
    other.id = "art_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();

    // A duplicate completion for the same attempt (at-least-once delivery).
    let err = store
        .succeed_attempt(
            &attempt.id,
            &[("train".to_owned(), other.clone())],
            None,
            LATER,
        )
        .await
        .unwrap_err();

    assert!(matches!(err, StoreError::Transition(_)), "{err}");
    assert!(store.get_artifact(&other.id).await.is_err(), "rolled back");
    assert_eq!(store.outputs(&attempt.id).await.unwrap().len(), 1);
}

#[tokio::test]
async fn run_status_change_is_audited_and_terminal_sets_finished_at() {
    let (store, run) = store_with_run().await;

    let done = store
        .set_run_status(&run.id, RunStatus::Succeeded, LATER)
        .await
        .unwrap();

    assert_eq!(done.status, RunStatus::Succeeded);
    assert_eq!(done.finished_at, Some(LATER.parse().unwrap()));
    assert_eq!(
        store.audit_events(run.id.as_str()).await.unwrap(),
        vec![(LATER.to_owned(), "run.running->succeeded".to_owned())]
    );
}

#[tokio::test]
async fn finished_run_status_never_changes() {
    let (store, run) = store_with_run().await;
    store
        .set_run_status(&run.id, RunStatus::Failed, LATER)
        .await
        .unwrap();

    let err = store
        .set_run_status(&run.id, RunStatus::Succeeded, LATER)
        .await
        .unwrap_err();

    assert!(matches!(err, StoreError::RunFinished { .. }), "{err}");
}

#[tokio::test]
async fn failing_an_attempt_records_its_error() {
    let (store, _, attempt) = store_with_queued_attempt().await;
    let error: sprisk_contracts::Error =
        parse(r#"{"code": "lease_expired", "message": "no heartbeat for 30s"}"#).unwrap();

    let worker = "wrk_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    store
        .lease_attempt(&attempt.id, &worker, &LATER.parse().unwrap(), NOW)
        .await
        .unwrap();

    let failed = store
        .fail_attempt(&attempt.id, AttemptState::TimedOut, &error, LATER)
        .await
        .unwrap();

    assert_eq!(failed.state, AttemptState::TimedOut);
    assert_eq!(failed.error, Some(error));
}

#[tokio::test]
async fn pipeline_version_round_trips_and_is_never_replaced() {
    let store = SqliteStore::in_memory().await.unwrap();
    let pipeline: sprisk_contracts::PipelineVersion =
        fixture("pipeline_version", "all-fields.json");
    store.insert_pipeline_version(&pipeline).await.unwrap();

    assert_eq!(
        store.get_pipeline_version(&pipeline.id).await.unwrap(),
        pipeline
    );
    let err = store.insert_pipeline_version(&pipeline).await.unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
}

#[tokio::test]
async fn file_database_is_created_and_keeps_data_across_opens() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sprisk.db");
    let run: Run = fixture("run", "running.json");
    SqliteStore::open(&path)
        .await
        .unwrap()
        .insert_run(&run)
        .await
        .unwrap();

    let reopened = SqliteStore::open(&path).await.unwrap();

    assert_eq!(reopened.get_run(&run.id).await.unwrap(), run);
}

fn run_with_id(id: &str, pipeline: &str) -> Run {
    let mut run: Run = fixture("run", "running.json");
    run.id = id.parse().unwrap();
    run.pipeline_version_id = pipeline.parse().unwrap();
    run
}

#[tokio::test]
async fn runs_are_listed_newest_first_filtered_and_paged() {
    let store = SqliteStore::in_memory().await.unwrap();
    let a = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0";
    let b = "plv_01JABCDEFGHJKMNPQRSTVWXYZ1";
    for (id, p) in [
        ("run_01JABCDEFGHJKMNPQRSTVWXYZ1", a),
        ("run_01JABCDEFGHJKMNPQRSTVWXYZ2", b),
        ("run_01JABCDEFGHJKMNPQRSTVWXYZ3", a),
    ] {
        store.insert_run(&run_with_id(id, p)).await.unwrap();
    }
    let ids = |runs: Vec<Run>| {
        runs.into_iter()
            .map(|r| r.id.as_str().to_owned())
            .collect::<Vec<_>>()
    };

    let all = store.list_runs(None, None, 10).await.unwrap();
    assert_eq!(
        ids(all),
        [
            "run_01JABCDEFGHJKMNPQRSTVWXYZ3",
            "run_01JABCDEFGHJKMNPQRSTVWXYZ2",
            "run_01JABCDEFGHJKMNPQRSTVWXYZ1"
        ]
    );
    let of_a = store
        .list_runs(Some(&a.parse().unwrap()), None, 10)
        .await
        .unwrap();
    assert_eq!(
        ids(of_a),
        [
            "run_01JABCDEFGHJKMNPQRSTVWXYZ3",
            "run_01JABCDEFGHJKMNPQRSTVWXYZ1"
        ]
    );
    let page = store
        .list_runs(
            None,
            Some(&"run_01JABCDEFGHJKMNPQRSTVWXYZ3".parse().unwrap()),
            1,
        )
        .await
        .unwrap();
    assert_eq!(ids(page), ["run_01JABCDEFGHJKMNPQRSTVWXYZ2"]);
}

#[tokio::test]
async fn pipeline_versions_are_listed_newest_first_and_paged() {
    let store = SqliteStore::in_memory().await.unwrap();
    let base: sprisk_contracts::PipelineVersion = fixture("pipeline_version", "all-fields.json");
    for n in 1..=3 {
        let mut p = base.clone();
        p.id = format!("plv_01JABCDEFGHJKMNPQRSTVWXYZ{n}").parse().unwrap();
        store.insert_pipeline_version(&p).await.unwrap();
    }
    let listed = store.list_pipeline_versions(None, 2).await.unwrap();
    let ids: Vec<_> = listed.iter().map(|p| p.id.as_str().to_owned()).collect();
    assert_eq!(
        ids,
        [
            "plv_01JABCDEFGHJKMNPQRSTVWXYZ3",
            "plv_01JABCDEFGHJKMNPQRSTVWXYZ2"
        ]
    );
}

const KEY: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

/// A succeeded attempt whose outputs are recorded under `KEY`.
async fn cached_success() -> (SqliteStore, Attempt, Artifact) {
    let (store, _, attempt) = store_with_queued_attempt().await;
    uploading_attempt(&store, &attempt).await;
    let mut artifact: Artifact = fixture("artifact", "parquet-with-schema.json");
    artifact.producer_attempt_id = attempt.id.clone();
    store
        .succeed_attempt(
            &attempt.id,
            &[("train".to_owned(), artifact.clone())],
            Some(KEY),
            LATER,
        )
        .await
        .unwrap();
    (store, attempt, artifact)
}

fn later_attempt(base: &Attempt, state: AttemptState) -> Attempt {
    let mut next = base.clone();
    next.id = "att_01JABCDEFGHJKMNPQRSTVWXY77".parse().unwrap();
    next.number = (base.number.get() + 1).try_into().unwrap();
    next.state = state;
    next.worker_id = None;
    next.lease_expires_at = None;
    next
}

#[tokio::test]
async fn success_with_a_cache_key_can_be_found_by_it() {
    let (store, attempt, _) = cached_success().await;
    assert_eq!(store.cached_attempt(KEY).await.unwrap(), Some(attempt.id));
    let other = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
    assert_eq!(store.cached_attempt(other).await.unwrap(), None);
}

#[tokio::test]
async fn cache_hit_reuses_the_source_outputs_in_a_new_attempt() {
    let (store, source, artifact) = cached_success().await;
    let hit = later_attempt(&source, AttemptState::Validated);
    store.insert_attempt(&hit).await.unwrap();

    let done = store.hit_cache(&hit.id, &source.id, LATER).await.unwrap();

    assert_eq!(done.state, AttemptState::CacheHit);
    assert_eq!(
        store.outputs(&hit.id).await.unwrap(),
        vec![("train".to_owned(), artifact)]
    );
    let events = store.audit_events(hit.id.as_str()).await.unwrap();
    assert!(
        events
            .iter()
            .any(|(_, e)| e == "attempt.validated->cache_hit"),
        "{events:?}"
    );
}

#[tokio::test]
async fn cache_hit_needs_a_validated_attempt_and_records_nothing_otherwise() {
    let (store, source, _) = cached_success().await;
    let hit = later_attempt(&source, AttemptState::Queued);
    store.insert_attempt(&hit).await.unwrap();

    assert!(store.hit_cache(&hit.id, &source.id, LATER).await.is_err());
    assert!(store.outputs(&hit.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_run_s_result_for_a_step_is_found_by_its_definition_key() {
    let (store, attempt, _) = cached_success().await;
    store.record_step_key(&attempt.id, KEY).await.unwrap();
    let run = attempt.run_id.clone();
    let node = attempt.node_id.as_str();

    assert_eq!(
        store.reusable_attempt(&run, node, KEY).await.unwrap(),
        Some(attempt.id.clone())
    );
    let other = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
    assert_eq!(
        store.reusable_attempt(&run, node, other).await.unwrap(),
        None
    );
    assert_eq!(
        store
            .reusable_attempt(&run, "elsewhere", KEY)
            .await
            .unwrap(),
        None
    );
}

fn notebook_version(id: &str, notebook: &str) -> NotebookVersion {
    let mut version: NotebookVersion = fixture("notebook_version", "first-empty.json");
    version.id = id.parse().unwrap();
    version.notebook_id = notebook.parse().unwrap();
    version
}

#[tokio::test]
async fn notebook_version_round_trips() {
    let store = SqliteStore::in_memory().await.unwrap();
    let saved: NotebookVersion = fixture("notebook_version", "sales.json");
    store.insert_notebook_version(&saved).await.unwrap();
    assert_eq!(store.get_notebook_version(&saved.id).await.unwrap(), saved);
}

#[tokio::test]
async fn unknown_notebook_version_is_not_found() {
    let store = SqliteStore::in_memory().await.unwrap();
    let missing = "nbv_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();
    assert!(matches!(
        store.get_notebook_version(&missing).await,
        Err(StoreError::NotFound { .. })
    ));
}

#[tokio::test]
async fn notebooks_list_each_notebooks_latest_version_newest_first() {
    let store = SqliteStore::in_memory().await.unwrap();
    let a1 = notebook_version(
        "nbv_01JA0000000000000000000001",
        "nb_01JA000000000000000000000A",
    );
    let b1 = notebook_version(
        "nbv_01JA0000000000000000000002",
        "nb_01JA000000000000000000000B",
    );
    let a2 = notebook_version(
        "nbv_01JA0000000000000000000003",
        "nb_01JA000000000000000000000A",
    );
    for version in [&a1, &b1, &a2] {
        store.insert_notebook_version(version).await.unwrap();
    }

    let latest = store.latest_notebook_versions(10).await.unwrap();

    assert_eq!(latest, vec![a2.clone(), b1]);
    assert_eq!(store.latest_notebook_versions(1).await.unwrap(), vec![a2]);
}

#[tokio::test]
async fn an_audit_event_is_appended_for_its_entity() {
    let store = SqliteStore::in_memory().await.unwrap();
    store
        .append_audit(NOW, "nb_01JA000000000000000000000A", "cell c1 executed")
        .await
        .unwrap();
    assert_eq!(
        store
            .audit_events("nb_01JA000000000000000000000A")
            .await
            .unwrap(),
        vec![(NOW.to_owned(), "cell c1 executed".to_owned())]
    );
}
