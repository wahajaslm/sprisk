#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;
use sprisk_contracts::{Artifact, Attempt, AttemptState, Run, RunStatus, parse};
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
        .succeed_attempt(&attempt.id, &outputs, LATER)
        .await
        .unwrap();
    let mut other = artifact.clone();
    other.id = "art_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();

    // A duplicate completion for the same attempt (at-least-once delivery).
    let err = store
        .succeed_attempt(&attempt.id, &[("train".to_owned(), other.clone())], LATER)
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
