#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;
use sprisk_contracts::{Artifact, Attempt, AttemptState, Run, parse};
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
