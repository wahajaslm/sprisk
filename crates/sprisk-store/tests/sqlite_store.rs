#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;
use sprisk_contracts::{
    Artifact, Attempt, AttemptState, MethodologyDecision, MethodologyDecisionByMethod,
    MethodologyDecisionByRule, NotebookVersion, Run, RunStatus, parse,
};
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
async fn a_notebook_whose_latest_version_is_removed_is_not_listed() {
    let store = SqliteStore::in_memory().await.unwrap();
    let a1 = notebook_version(
        "nbv_01JA0000000000000000000001",
        "nb_01JA000000000000000000000A",
    );
    let b1 = notebook_version(
        "nbv_01JA0000000000000000000002",
        "nb_01JA000000000000000000000B",
    );
    let mut b2 = notebook_version(
        "nbv_01JA0000000000000000000003",
        "nb_01JA000000000000000000000B",
    );
    b2.parent_id = Some(b1.id.clone());
    b2.removed = Some(true);
    for version in [&a1, &b1, &b2] {
        store.insert_notebook_version(version).await.unwrap();
    }

    assert_eq!(
        store.latest_notebook_versions(1).await.unwrap(),
        vec![a1.clone()]
    );
    assert_eq!(store.get_notebook_version(&b1.id).await.unwrap(), b1);
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

#[tokio::test]
async fn a_notebook_exists_once_a_version_of_it_is_saved() {
    let store = SqliteStore::in_memory().await.unwrap();
    let saved: NotebookVersion = fixture("notebook_version", "sales.json");
    assert!(!store.has_notebook(&saved.notebook_id).await.unwrap());
    store.insert_notebook_version(&saved).await.unwrap();
    assert!(store.has_notebook(&saved.notebook_id).await.unwrap());
}

#[tokio::test]
async fn each_step_s_latest_outputs_are_listed_with_their_run_and_port() {
    let (store, attempt, artifact) = cached_success().await;
    let version = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    let other = "plv_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();

    let rows = store.latest_outputs(&[version, other]).await.unwrap();

    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(
        row.pipeline_version_id.as_str(),
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"
    );
    assert_eq!(row.run_id, attempt.run_id);
    assert_eq!(row.node_id, attempt.node_id.as_str());
    assert_eq!((row.port.as_str(), &row.artifact), ("train", &artifact));
}

#[tokio::test]
async fn a_newer_run_that_has_not_made_the_step_s_outputs_keeps_the_older_ones() {
    let (store, attempt, artifact) = cached_success().await;
    let version: sprisk_contracts::PipelineVersionId =
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    let newer = run_with_id("run_01JABCDEFGHJKMNPQRSTVWXYZ9", version.as_str());
    store.insert_run(&newer).await.unwrap();

    let rows = store.latest_outputs(&[version]).await.unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(
        (&rows[0].run_id, &rows[0].artifact),
        (&attempt.run_id, &artifact)
    );
}

/// A contract fixture with some fields replaced, so linked records agree on their ids.
fn fixture_with<T: DeserializeOwned>(entity: &str, name: &str, fields: serde_json::Value) -> T {
    let mut value: serde_json::Value = fixture(entity, name);
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    parse(&value.to_string()).unwrap()
}

/// A store holding one question, a base pipeline, a proposal for it and the applied decision.
async fn store_with_decision() -> (SqliteStore, MethodologyDecisionByRule) {
    let store = SqliteStore::in_memory().await.unwrap();
    let question: sprisk_contracts::QuestionVersion = fixture_with(
        "question_version",
        "classification-all-fields.json",
        serde_json::json!({"id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    store.insert_question_version(&question).await.unwrap();
    let base: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        serde_json::json!({"id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    store.insert_pipeline_version(&base).await.unwrap();
    let proposal: sprisk_contracts::DecisionProposal = fixture("decision_proposal", "split.json");
    store.insert_methodology_proposal(&proposal).await.unwrap();
    let applied: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        serde_json::json!({"id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1"}),
    );
    let decision: MethodologyDecisionByRule = fixture("methodology_decision", "applied.json");
    store
        .apply_methodology_decision(&decision.clone().into(), Some(&applied), "key-0001")
        .await
        .unwrap();
    (store, decision)
}

#[tokio::test]
async fn methodology_decisions_are_found_by_their_ids_and_unknown_ids_are_left_out() {
    let (store, decision) = store_with_decision().await;
    let unknown: sprisk_contracts::MethodologyDecisionId =
        "mdc_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();

    let found = store
        .methodology_decisions(&[decision.id.clone(), unknown])
        .await
        .unwrap();

    assert_eq!(found, vec![decision.into()]);
}

#[tokio::test]
async fn a_comparison_is_found_by_its_proposal_and_a_proposal_has_one() {
    let (store, decision) = store_with_decision().await;
    let comparison: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "comparison.json",
        serde_json::json!({ "compares": decision.proposal_id, "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0" }),
    );
    assert_eq!(
        store.comparison_of(&decision.proposal_id).await.unwrap(),
        None
    );

    store.insert_pipeline_version(&comparison).await.unwrap();

    assert_eq!(
        store.comparison_of(&decision.proposal_id).await.unwrap(),
        Some(comparison.clone())
    );
    let mut second = comparison;
    second.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ7".parse().unwrap();
    let err = store.insert_pipeline_version(&second).await.unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
}

#[tokio::test]
async fn a_version_s_step_has_one_model_selection_and_one_run_whoever_asks_first() {
    let (store, decision) = store_with_decision().await;
    let base = decision.base_pipeline_version_id.clone();
    let step: sprisk_contracts::NodeId = decision.subject_node_id.clone();
    let first: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "comparison.json",
        serde_json::json!({ "compares": decision.proposal_id, "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0" }),
    );
    let mut second = first.clone();
    second.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ6".parse().unwrap();
    second.compares = None;
    assert_eq!(store.selection_for(&base, &step).await.unwrap(), None);

    let (kept, created) = store.insert_selection(&base, &step, &first).await.unwrap();
    assert!(created);
    assert_eq!(kept, first);
    let (kept, created) = store.insert_selection(&base, &step, &second).await.unwrap();
    assert!(!created);
    assert_eq!(kept, first);
    assert!(matches!(
        store.get_pipeline_version(&second.id).await,
        Err(StoreError::NotFound { .. })
    ));

    let mut run: Run = fixture("run", "running.json");
    run.pipeline_version_id = first.id.clone();
    let mut other = run.clone();
    other.id = "run_01JABCDEFGHJKMNPQRSTVWXYZ6".parse().unwrap();
    assert_eq!(
        store.claim_selection_run(&base, &step, &run).await.unwrap(),
        run
    );
    assert_eq!(
        store
            .claim_selection_run(&base, &step, &other)
            .await
            .unwrap(),
        run
    );
    assert!(matches!(
        store.get_run(&other.id).await,
        Err(StoreError::NotFound { .. })
    ));
    assert_eq!(
        store.selection_for(&base, &step).await.unwrap(),
        Some((first, Some(run)))
    );
}

#[tokio::test]
async fn a_proposal_s_own_branches_do_not_make_its_flow_changed() {
    let (store, decision) = store_with_decision().await;
    let base = decision.base_pipeline_version_id.clone();
    // The decision's version is a child of the base, made by this proposal.
    let mut child: sprisk_contracts::PipelineVersion =
        fixture("pipeline_version", "single-node-no-parent.json");
    assert!(
        !store
            .has_other_child(&base, &decision.proposal_id)
            .await
            .unwrap()
    );
    assert_eq!(
        store.decisions_of(&decision.proposal_id).await.unwrap(),
        vec![decision.clone()]
    );

    child.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ8".parse().unwrap();
    child.parent_id = Some(base.clone());
    store.insert_pipeline_version(&child).await.unwrap();
    assert!(
        store
            .has_other_child(&base, &decision.proposal_id)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn an_apply_key_gives_its_decision_to_the_same_choice_and_refuses_another() {
    // Two requests racing with one key both reach the store; the second must not take the
    // first's decision as its own when it asked for something else (SCI-07).
    let (store, decision) = store_with_decision().await;
    let applied: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        serde_json::json!({"id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ2"}),
    );
    let mut retry = decision.clone();
    retry.id = "mdc_01JABCDEFGHJKMNPQRSTVWXYZ8".parse().unwrap();
    retry.pipeline_version_id = applied.id.clone();

    let kept = store
        .apply_methodology_decision(&retry.clone().into(), Some(&applied), "key-0001")
        .await
        .unwrap();
    assert_eq!(kept, decision.into());

    let mut other = retry;
    other.alternative_id = "stratified_random".parse().unwrap();
    let err = store
        .apply_methodology_decision(&other.into(), Some(&applied), "key-0001")
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
    assert!(
        err.to_string()
            .contains("idempotency key key-0001 was used for another request"),
        "{err}"
    );
}

/// The store of `store_with_decision`, and a method's decision on its base, not stored yet.
async fn store_with_method_decision(name: &str) -> (SqliteStore, MethodologyDecisionByMethod) {
    let (store, _) = store_with_decision().await;
    (store, fixture("methodology_decision", name))
}

#[tokio::test]
async fn a_method_decision_that_changed_no_step_is_kept_without_a_version() {
    let (store, decision) = store_with_method_decision("by-method-binds-only.json").await;
    let decision: MethodologyDecision = decision.into();

    let kept = store
        .apply_methodology_decision(&decision, None, "wlk-round-3")
        .await
        .unwrap();

    assert_eq!(kept, decision);
    let id = "mdc_01JABCDEFGHJKMNPQRSTVWXYZ3".parse().unwrap();
    assert_eq!(
        store.methodology_decisions(&[id]).await.unwrap(),
        vec![decision]
    );
}

#[tokio::test]
async fn a_method_decision_is_saved_with_the_version_it_made() {
    let (store, decision) = store_with_method_decision("by-method-changes-steps.json").await;
    let made: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        serde_json::json!({"id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ5"}),
    );
    let mut decision = decision;
    decision.pipeline_version_id = Some(made.id.clone());

    store
        .apply_methodology_decision(&decision.into(), Some(&made), "wlk-round-4")
        .await
        .unwrap();

    assert_eq!(store.get_pipeline_version(&made.id).await.unwrap(), made);
}

#[tokio::test]
async fn a_walk_round_s_key_gives_its_method_decision_to_the_same_option_and_refuses_another() {
    let (store, decision) = store_with_method_decision("by-method-binds-only.json").await;
    store
        .apply_methodology_decision(&decision.clone().into(), None, "wlk-round-3")
        .await
        .unwrap();
    let mut retry = decision.clone();
    retry.id = "mdc_01JABCDEFGHJKMNPQRSTVWXYZ8".parse().unwrap();

    let kept = store
        .apply_methodology_decision(&retry.clone().into(), None, "wlk-round-3")
        .await
        .unwrap();
    assert_eq!(kept, decision.into());

    let mut other = retry;
    other.option = "keep_rows".parse().unwrap();
    let err = store
        .apply_methodology_decision(&other.into(), None, "wlk-round-3")
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
}

/// A study of the decision's base version, its comparison and its run, none stored yet.
fn study_parts(
    decision: &MethodologyDecisionByRule,
) -> (
    sprisk_contracts::Study,
    sprisk_contracts::CreateStudy,
    sprisk_contracts::PipelineVersion,
    Run,
) {
    let comparison: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "comparison.json",
        serde_json::json!({ "compares": decision.proposal_id, "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0" }),
    );
    let mut run: Run = fixture("run", "running.json");
    run.pipeline_version_id = comparison.id.clone();
    let study: sprisk_contracts::Study = fixture_with(
        "study",
        "running.json",
        serde_json::json!({
            "pipeline_version_id": decision.base_pipeline_version_id,
            "proposal_id": decision.proposal_id,
            "comparison_id": comparison.id,
            "run_id": run.id,
        }),
    );
    let request: sprisk_contracts::CreateStudy = fixture("create_study", "grid.json");
    (study, request, comparison, run)
}

/// The same study built again by a second request: new ids, same request.
fn rebuilt(
    study: &sprisk_contracts::Study,
    comparison: &sprisk_contracts::PipelineVersion,
    run: &Run,
) -> (
    sprisk_contracts::Study,
    sprisk_contracts::PipelineVersion,
    Run,
) {
    let mut comparison = comparison.clone();
    comparison.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ6".parse().unwrap();
    // Each request proposes anew, so its comparison never compares the first one's proposal.
    comparison.compares = None;
    let mut run = run.clone();
    run.id = "run_01JABCDEFGHJKMNPQRSTVWXYZ6".parse().unwrap();
    run.pipeline_version_id = comparison.id.clone();
    let mut study = study.clone();
    study.id = "std_01JABCDEFGHJKMNPQRSTVWXYZ6".parse().unwrap();
    study.comparison_id = comparison.id.clone();
    study.run_id = run.id.clone();
    (study, comparison, run)
}

#[tokio::test]
async fn a_study_key_gives_its_study_to_the_same_request_and_refuses_another() {
    let (store, decision) = store_with_decision().await;
    let (study, request, comparison, run) = study_parts(&decision);
    let (kept, created) = store
        .insert_study(&study, &request, &comparison, &run)
        .await
        .unwrap();
    assert!(created);
    assert_eq!(kept, study);
    assert_eq!(store.get_study(&study.id).await.unwrap(), study);
    assert_eq!(
        store.get_pipeline_version(&comparison.id).await.unwrap(),
        comparison
    );
    assert_eq!(store.get_run(&run.id).await.unwrap(), run);

    let (again, again_comparison, again_run) = rebuilt(&study, &comparison, &run);
    let (kept, created) = store
        .insert_study(&again, &request, &again_comparison, &again_run)
        .await
        .unwrap();
    assert!(!created);
    assert_eq!(kept, study);
    assert!(matches!(
        store.get_pipeline_version(&again_comparison.id).await,
        Err(StoreError::NotFound { .. })
    ));
    assert!(matches!(
        store.get_run(&again_run.id).await,
        Err(StoreError::NotFound { .. })
    ));

    let mut bigger = request.clone();
    bigger.max_trials += 1;
    let err = store
        .insert_study(&again, &bigger, &again_comparison, &again_run)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
    assert!(
        err.to_string()
            .contains("idempotency key study-forest-1 was used for another request"),
        "{err}"
    );

    let mut other_step = again.clone();
    other_step.node_id = "other_model".parse().unwrap();
    let err = store
        .insert_study(&other_step, &request, &again_comparison, &again_run)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn two_studies_stored_at_once_with_one_key_keep_one() {
    // A file database has a pool of connections, so the two transactions really race.
    let dir = tempfile::tempdir().unwrap();
    let store = SqliteStore::open(&dir.path().join("sprisk.db"))
        .await
        .unwrap();
    let question: sprisk_contracts::QuestionVersion = fixture_with(
        "question_version",
        "classification-all-fields.json",
        serde_json::json!({"id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    store.insert_question_version(&question).await.unwrap();
    let base: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        serde_json::json!({"id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    store.insert_pipeline_version(&base).await.unwrap();
    let proposal: sprisk_contracts::DecisionProposal = fixture("decision_proposal", "split.json");
    store.insert_methodology_proposal(&proposal).await.unwrap();
    let decision: MethodologyDecisionByRule = fixture("methodology_decision", "applied.json");
    let (study, request, comparison, run) = study_parts(&decision);
    let (again, again_comparison, again_run) = rebuilt(&study, &comparison, &run);

    let (first, second) = tokio::join!(
        store.insert_study(&study, &request, &comparison, &run),
        store.insert_study(&again, &request, &again_comparison, &again_run),
    );
    let ((one, made_one), (two, made_two)) = (first.unwrap(), second.unwrap());
    assert_eq!(one, two);
    assert!(made_one != made_two, "exactly one request stores its study");
    assert_eq!(
        store.studies_of(&base.id, 10).await.unwrap(),
        vec![one.clone()]
    );
}

#[tokio::test]
async fn a_finished_study_keeps_its_status_and_when_it_ended() {
    let (store, decision) = store_with_decision().await;
    let (study, request, comparison, run) = study_parts(&decision);
    store
        .insert_study(&study, &request, &comparison, &run)
        .await
        .unwrap();
    let ended = store
        .finish_study(&study.id, sprisk_contracts::StudyStatus::BudgetReached, NOW)
        .await
        .unwrap();
    assert_eq!(ended.status, sprisk_contracts::StudyStatus::BudgetReached);
    assert_eq!(ended.finished_at.as_ref().unwrap().as_str(), NOW);
    assert_eq!(store.get_study(&study.id).await.unwrap(), ended);
    let err = store
        .finish_study(&study.id, sprisk_contracts::StudyStatus::Completed, NOW)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::StudyFinished { .. }), "{err}");
}

#[tokio::test]
async fn an_unknown_study_is_not_found() {
    let store = SqliteStore::in_memory().await.unwrap();
    let id = "std_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap();
    assert!(matches!(
        store.get_study(&id).await,
        Err(StoreError::NotFound {
            entity: "study",
            ..
        })
    ));
}

#[tokio::test]
async fn a_step_has_one_running_study_at_a_time() {
    let (store, decision) = store_with_decision().await;
    let (study, request, comparison, run) = study_parts(&decision);
    store
        .insert_study(&study, &request, &comparison, &run)
        .await
        .unwrap();
    let (other, other_comparison, other_run) = rebuilt(&study, &comparison, &run);
    let mut other_request = request.clone();
    other_request.idempotency_key = "study-forest-2".parse().unwrap();

    let err = store
        .insert_study(&other, &other_request, &other_comparison, &other_run)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
    assert!(err.to_string().contains("still running"), "{err}");

    store
        .finish_study(&study.id, sprisk_contracts::StudyStatus::Completed, NOW)
        .await
        .unwrap();
    let (_, created) = store
        .insert_study(&other, &other_request, &other_comparison, &other_run)
        .await
        .unwrap();
    assert!(created);
}

#[tokio::test]
async fn a_study_s_deadline_is_set_once_so_a_resumed_run_keeps_it() {
    let (store, decision) = store_with_decision().await;
    let (study, request, comparison, run) = study_parts(&decision);
    store
        .insert_study(&study, &request, &comparison, &run)
        .await
        .unwrap();
    let started = store
        .start_study(&study.id, "2026-10-21T10:10:00Z")
        .await
        .unwrap();
    assert_eq!(started.deadline.unwrap().as_str(), "2026-10-21T10:10:00Z");
    let resumed = store
        .start_study(&study.id, "2026-10-21T11:00:00Z")
        .await
        .unwrap();
    assert_eq!(resumed.deadline.unwrap().as_str(), "2026-10-21T10:10:00Z");
}

/// Stores a model selection of `step` of `pipeline`, compared by `comparison` in `run`.
async fn selection(
    store: &SqliteStore,
    pipeline: &sprisk_contracts::PipelineVersionId,
    step: &sprisk_contracts::NodeId,
    comparison: &str,
    run: &str,
) -> Run {
    let mut compared: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "comparison.json",
        serde_json::json!({ "id": comparison, "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0" }),
    );
    compared.compares = None;
    store
        .insert_selection(pipeline, step, &compared)
        .await
        .unwrap();
    let mut claimed: Run = fixture("run", "running.json");
    claimed.id = run.parse().unwrap();
    claimed.pipeline_version_id = compared.id;
    store
        .claim_selection_run(pipeline, step, &claimed)
        .await
        .unwrap()
}

#[tokio::test]
async fn looks_count_the_decided_model_selections_of_the_flow_s_whole_family() {
    let (store, decision) = store_with_decision().await;
    let base = decision.base_pipeline_version_id.clone();
    let step = decision.subject_node_id.clone();
    let made_from = |id: &str| -> sprisk_contracts::PipelineVersion {
        fixture_with(
            "pipeline_version",
            "single-node-no-parent.json",
            serde_json::json!({ "id": id, "parent_id": base }),
        )
    };
    let child = made_from("plv_01JABCDEFGHJKMNPQRSTVWXYZ5");
    let sibling = made_from("plv_01JABCDEFGHJKMNPQRSTVWXYZ4");
    store.insert_pipeline_version(&child).await.unwrap();
    store.insert_pipeline_version(&sibling).await.unwrap();
    assert_eq!(store.looks(&child.id).await.unwrap(), 0);

    let first = selection(
        &store,
        &base,
        &step,
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ6",
        "run_01JABCDEFGHJKMNPQRSTVWXYZ6",
    )
    .await;
    store
        .set_run_status(&first.id, RunStatus::Succeeded, LATER)
        .await
        .unwrap();
    assert_eq!(store.looks(&child.id).await.unwrap(), 1);

    // A renamed model step is still a look at the same folds.
    let renamed: sprisk_contracts::NodeId = "renamed".parse().unwrap();
    let second = selection(
        &store,
        &child.id,
        &renamed,
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ7",
        "run_01JABCDEFGHJKMNPQRSTVWXYZ7",
    )
    .await;
    assert_eq!(store.looks(&child.id).await.unwrap(), 1, "still running");
    store
        .set_run_status(&second.id, RunStatus::Succeeded, LATER)
        .await
        .unwrap();
    // A branch from the same root cannot start its count again.
    for version in [&base, &child.id, &sibling.id] {
        assert_eq!(
            store.looks(version).await.unwrap(),
            2,
            "{}",
            version.as_str()
        );
    }
}

#[tokio::test]
async fn a_completed_study_is_a_look_too() {
    let (store, decision) = store_with_decision().await;
    let (study, request, comparison, run) = study_parts(&decision);
    store
        .insert_study(&study, &request, &comparison, &run)
        .await
        .unwrap();
    let looks = || store.looks(&study.pipeline_version_id);
    assert_eq!(looks().await.unwrap(), 0);
    store
        .finish_study(&study.id, sprisk_contracts::StudyStatus::Completed, NOW)
        .await
        .unwrap();
    assert_eq!(looks().await.unwrap(), 1);
}

/// A store holding the question a walk asks, and the walk's request, record, first version
/// and build step (ADR-0060).
async fn walk_parts() -> (
    SqliteStore,
    sprisk_contracts::Walk,
    sprisk_contracts::CreateWalk,
    sprisk_contracts::PipelineVersion,
    sprisk_contracts::WalkStep,
) {
    let store = SqliteStore::in_memory().await.unwrap();
    let question: sprisk_contracts::QuestionVersion = fixture_with(
        "question_version",
        "classification-all-fields.json",
        serde_json::json!({"id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    store.insert_question_version(&question).await.unwrap();
    let walk: sprisk_contracts::Walk = fixture("walk", "walking.json");
    let request: sprisk_contracts::CreateWalk = fixture("create_walk", "two-datasets.json");
    let first: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        serde_json::json!({"id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    let detail: sprisk_contracts::WalkDetail = fixture("walk_detail", "trail.json");
    let build = detail.steps[0].clone();
    (store, walk, request, first, build)
}

#[tokio::test]
async fn a_walk_key_gives_its_walk_to_the_same_request_and_refuses_another() {
    let (store, walk, request, first, build) = walk_parts().await;
    let (kept, created) = store
        .insert_walk(&walk, &request, Some(&first), &build)
        .await
        .unwrap();
    assert!(created);
    assert_eq!(kept, walk);
    assert_eq!(store.get_walk(&walk.id).await.unwrap(), walk);
    assert_eq!(store.get_pipeline_version(&first.id).await.unwrap(), first);
    assert_eq!(
        store.walk_steps(&walk.id).await.unwrap(),
        vec![build.clone()]
    );

    let mut again = walk.clone();
    again.id = "wlk_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();
    let mut again_first = first.clone();
    again_first.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();
    let (kept, created) = store
        .insert_walk(&again, &request, Some(&again_first), &build)
        .await
        .unwrap();
    assert!(!created);
    assert_eq!(kept, walk);
    assert!(matches!(
        store.get_pipeline_version(&again_first.id).await,
        Err(StoreError::NotFound { .. })
    ));

    let mut longer = request.clone();
    longer.max_actions += 1;
    let err = store
        .insert_walk(&again, &longer, Some(&again_first), &build)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
}

#[tokio::test]
async fn a_question_s_walks_are_listed_newest_first_and_paged() {
    let (store, walk, request, _, build) = walk_parts().await;
    let other: sprisk_contracts::QuestionVersion = fixture_with(
        "question_version",
        "classification-all-fields.json",
        serde_json::json!({"id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ1"}),
    );
    store.insert_question_version(&other).await.unwrap();
    let mut walks = Vec::new();
    for (n, question) in [
        (1, &walk.question_version_id),
        (2, &other.id),
        (3, &walk.question_version_id),
    ] {
        let mut made = walk.clone();
        made.id = format!("wlk_01JABCDEFGHJKMNPQRSTVWXYZ{n}").parse().unwrap();
        made.question_version_id = question.clone();
        let mut asked = request.clone();
        asked.idempotency_key = format!("walk-list-{n}").parse().unwrap();
        let mut step = build.clone();
        step.walk_id = made.id.clone();
        store.insert_walk(&made, &asked, None, &step).await.unwrap();
        walks.push(made);
    }
    let question = Some(&walk.question_version_id);

    let page = store.list_walks(question, None, 1).await.unwrap();
    assert_eq!(page, vec![walks[2].clone()]);
    let next = store
        .list_walks(question, Some(&walks[2].id), 10)
        .await
        .unwrap();
    assert_eq!(next, vec![walks[0].clone()]);
    assert_eq!(store.list_walks(None, None, 10).await.unwrap().len(), 3);
}

#[tokio::test]
async fn a_completed_walk_s_report_is_kept_with_its_last_step_once() {
    let (store, walk, request, first, build) = walk_parts().await;
    store
        .insert_walk(&walk, &request, Some(&first), &build)
        .await
        .unwrap();
    let detail: sprisk_contracts::WalkDetail = fixture("walk_detail", "trail.json");
    let mut last = detail.steps[3].clone();
    last.round = 1;
    let report: sprisk_contracts::Report = fixture("report", "complete.json");
    assert!(matches!(
        store.walk_report(&walk.id).await,
        Err(StoreError::NotFound { .. })
    ));

    store
        .record_walk_report(&detail.walk, &last, &report)
        .await
        .unwrap();

    assert_eq!(store.walk_report(&walk.id).await.unwrap(), report.clone());
    assert_eq!(store.get_walk(&walk.id).await.unwrap(), detail.walk);
    let mut again = report;
    again.id = "rpt_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();
    last.round = 2;
    let err = store
        .record_walk_report(&detail.walk, &last, &again)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
    assert_eq!(store.walk_steps(&walk.id).await.unwrap().len(), 2);
}

#[tokio::test]
async fn a_walk_step_is_kept_once_per_round_with_the_walk_it_leaves() {
    let (store, walk, request, first, build) = walk_parts().await;
    store
        .insert_walk(&walk, &request, Some(&first), &build)
        .await
        .unwrap();
    let detail: sprisk_contracts::WalkDetail = fixture("walk_detail", "trail.json");
    let run = detail.steps[1].clone();
    let mut stopped = walk.clone();
    stopped.status = sprisk_contracts::WalkStatus::Stopped;
    stopped.stop = detail.walk.stop.clone();
    stopped.finished_at = detail.walk.finished_at;

    store.record_walk_step(&stopped, &run).await.unwrap();
    assert_eq!(store.get_walk(&walk.id).await.unwrap(), stopped);
    assert_eq!(
        store.walk_steps(&walk.id).await.unwrap(),
        vec![build.clone(), run.clone()]
    );

    // A restarted walk that redoes round 1 records nothing and leaves the walk as it was.
    let err = store.record_walk_step(&walk, &run).await.unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
    assert_eq!(store.get_walk(&walk.id).await.unwrap(), stopped);
}

#[tokio::test]
async fn a_version_takes_the_walk_that_made_it_or_its_nearest_ancestor() {
    let (store, walk, request, first, build) = walk_parts().await;
    store
        .insert_walk(&walk, &request, Some(&first), &build)
        .await
        .unwrap();
    let made = build.made_pipeline_version_id.clone().unwrap();
    assert_eq!(
        store.walk_making_nearest(&made).await.unwrap(),
        Some((walk.id.clone(), 0))
    );

    // A person's edit on top of the walk's version, and an edit of that edit.
    let mut edit = first.clone();
    edit.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ8".parse().unwrap();
    edit.parent_id = Some(made.clone());
    store.insert_pipeline_version(&edit).await.unwrap();
    let mut again = edit.clone();
    again.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();
    again.parent_id = Some(edit.id.clone());
    store.insert_pipeline_version(&again).await.unwrap();
    assert_eq!(
        store.walk_making_nearest(&again.id).await.unwrap(),
        Some((walk.id.clone(), 0))
    );

    // A flow no walk made, nor any of its ancestors.
    let mut alone = first.clone();
    alone.id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ7".parse().unwrap();
    store.insert_pipeline_version(&alone).await.unwrap();
    assert_eq!(store.walk_making_nearest(&alone.id).await.unwrap(), None);
}

#[tokio::test]
async fn a_selection_run_that_failed_or_was_cancelled_gives_way_to_a_fresh_one() {
    let (store, decision) = store_with_decision().await;
    let base = decision.base_pipeline_version_id.clone();
    let step = decision.subject_node_id.clone();
    let first = selection(
        &store,
        &base,
        &step,
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ6",
        "run_01JABCDEFGHJKMNPQRSTVWXYZ6",
    )
    .await;
    store
        .set_run_status(&first.id, RunStatus::Cancelled, LATER)
        .await
        .unwrap();

    let (comparison, _) = store.selection_for(&base, &step).await.unwrap().unwrap();
    let mut fresh: Run = fixture("run", "running.json");
    fresh.id = "run_01JABCDEFGHJKMNPQRSTVWXYZ7".parse().unwrap();
    fresh.pipeline_version_id = comparison.id.clone();
    assert_eq!(
        store
            .claim_selection_run(&base, &step, &fresh)
            .await
            .unwrap(),
        fresh
    );
    assert_eq!(
        store.get_run(&first.id).await.unwrap().status,
        RunStatus::Cancelled,
        "kept"
    );

    // A run that succeeded stays the selection's run.
    store
        .set_run_status(&fresh.id, RunStatus::Succeeded, LATER)
        .await
        .unwrap();
    let mut late = fresh.clone();
    late.id = "run_01JABCDEFGHJKMNPQRSTVWXYZ8".parse().unwrap();
    let kept = store
        .claim_selection_run(&base, &step, &late)
        .await
        .unwrap();
    assert_eq!(kept.id, fresh.id);
}

/// Walk `n` stored with its own key and first version, and the score step, run and scored
/// version of its round 1.
async fn walk_ready_to_score(
    store: &SqliteStore,
    n: u8,
    files: &[char],
) -> (
    sprisk_contracts::Walk,
    sprisk_contracts::WalkStep,
    Run,
    sprisk_contracts::PipelineVersion,
) {
    let (_, mut walk, mut request, mut first, mut build) = walk_parts().await;
    walk.id = format!("wlk_01JABCDEFGHJKMNPQRSTVWXYZ{n}").parse().unwrap();
    request.idempotency_key = format!("walk-key-{n}").parse().unwrap();
    first.id = format!("plv_01JABCDEFGHJKMNPQRSTVWXYZ{n}").parse().unwrap();
    build.walk_id = walk.id.clone();
    walk.head_pipeline_version_id = Some(first.id.clone());
    walk.source_hashes = files
        .iter()
        .map(|c| {
            format!("sha256:{}", c.to_string().repeat(64))
                .parse()
                .unwrap()
        })
        .collect();
    store
        .insert_walk(&walk, &request, Some(&first), &build)
        .await
        .unwrap();
    let scored: sprisk_contracts::PipelineVersion = fixture_with(
        "pipeline_version",
        "single-node-no-parent.json",
        serde_json::json!({"id": format!("plv_01JABCDEFGHJKMNPQRSTVWXYS{n}")}),
    );
    let mut run = run_with_id(
        &format!("run_01JABCDEFGHJKMNPQRSTVWXYZ{n}"),
        scored.id.as_str(),
    );
    run.status = RunStatus::Queued;
    let step: sprisk_contracts::WalkStep = fixture_with(
        "walk_step",
        "score.json",
        serde_json::json!({
            "walk_id": walk.id, "round": 1, "pipeline_version_id": first.id,
            "made_pipeline_version_id": scored.id, "run_id": run.id,
        }),
    );
    (walk, step, run, scored)
}
#[tokio::test]
async fn a_file_s_test_rows_are_spent_by_the_first_walk_that_scores_them() {
    let store = SqliteStore::in_memory().await.unwrap();
    let question: sprisk_contracts::QuestionVersion = fixture_with(
        "question_version",
        "classification-all-fields.json",
        serde_json::json!({"id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    store.insert_question_version(&question).await.unwrap();
    let (first, step, run, scored) = walk_ready_to_score(&store, 1, &['a', 'b']).await;
    let mut scoring = first.clone();
    scoring.head_pipeline_version_id = Some(scored.id.clone());
    assert_eq!(
        store
            .record_walk_score(&scoring, &step, &run, &scored)
            .await
            .unwrap(),
        None
    );
    assert_eq!(store.get_walk(&first.id).await.unwrap(), scoring);
    // The same round again is a round conflict, not spent rows.
    let err = store
        .record_walk_score(&scoring, &step, &run, &scored)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");

    // Any walk reading a spent file, in any order or beside new files, stores none of its
    // scoring; a walk on new files only scores.
    for (n, files, spent) in [
        (2, vec!['b', 'a'], true),
        (3, vec!['a', 'a'], true),
        (4, vec!['c', 'b'], true),
        (5, vec!['c'], false),
    ] {
        let (walk, step, run, scored) = walk_ready_to_score(&store, n, &files).await;
        let got = store
            .record_walk_score(&walk, &step, &run, &scored)
            .await
            .unwrap();
        assert_eq!(got, spent.then(|| first.id.clone()), "{files:?}");
        assert_eq!(
            store.walk_steps(&walk.id).await.unwrap().len(),
            if spent { 1 } else { 2 },
            "{files:?}"
        );
        assert_eq!(store.get_run(&run.id).await.is_ok(), !spent, "{files:?}");
    }
}

#[tokio::test]
async fn a_walk_without_source_hashes_cannot_spend_test_rows() {
    let store = SqliteStore::in_memory().await.unwrap();
    let question: sprisk_contracts::QuestionVersion = fixture_with(
        "question_version",
        "classification-all-fields.json",
        serde_json::json!({"id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"}),
    );
    store.insert_question_version(&question).await.unwrap();
    let (walk, step, run, scored) = walk_ready_to_score(&store, 1, &[]).await;
    let err = store
        .record_walk_score(&walk, &step, &run, &scored)
        .await
        .unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "{err}");
}

fn profile(rows: i64) -> sprisk_contracts::DatasetProfile {
    parse(
        &serde_json::json!({
            "total_rows": rows, "total_columns": 0, "profiled_rows": rows, "band_rows": 0,
            "columns": [], "correlation": {"columns": [], "pairs": []}
        })
        .to_string(),
    )
    .unwrap()
}

#[tokio::test]
async fn a_profile_is_kept_by_its_table_and_its_profiler_code() {
    let store = SqliteStore::in_memory().await.unwrap();
    assert_eq!(
        store
            .stored_profile("sha256:t", "sha256:p1", None)
            .await
            .unwrap(),
        None
    );

    store
        .save_profile("sha256:t", "sha256:p1", None, &profile(5))
        .await
        .unwrap();

    assert_eq!(
        store
            .stored_profile("sha256:t", "sha256:p1", None)
            .await
            .unwrap(),
        Some(profile(5))
    );
    // New profiler code profiles the table again.
    assert_eq!(
        store
            .stored_profile("sha256:t", "sha256:p2", None)
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn a_profile_with_a_label_is_kept_apart_from_one_without() {
    let store = SqliteStore::in_memory().await.unwrap();
    store
        .save_profile("sha256:t", "sha256:p", Some("y"), &profile(7))
        .await
        .unwrap();
    assert_eq!(
        store
            .stored_profile("sha256:t", "sha256:p", None)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .stored_profile("sha256:t", "sha256:p", Some("z"))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .stored_profile("sha256:t", "sha256:p", Some("y"))
            .await
            .unwrap(),
        Some(profile(7))
    );
}

#[tokio::test]
async fn saving_a_profile_twice_keeps_the_first() {
    let store = SqliteStore::in_memory().await.unwrap();
    store
        .save_profile("sha256:t", "sha256:p", None, &profile(5))
        .await
        .unwrap();
    store
        .save_profile("sha256:t", "sha256:p", None, &profile(6))
        .await
        .unwrap();
    assert_eq!(
        store
            .stored_profile("sha256:t", "sha256:p", None)
            .await
            .unwrap(),
        Some(profile(5))
    );
}

#[tokio::test]
async fn a_dataset_version_registered_twice_is_kept_once() {
    let store = SqliteStore::in_memory().await.unwrap();
    let first: sprisk_contracts::DatasetVersion = fixture("dataset_version", "local-csv.json");
    let mut again = first.clone();
    again.id = "dsv_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();

    assert_eq!(store.insert_dataset_version(&first).await.unwrap(), first);
    assert_eq!(store.insert_dataset_version(&again).await.unwrap(), first);

    assert_eq!(store.get_dataset_version(&first.id).await.unwrap(), first);
    assert_eq!(
        store.list_dataset_versions(None, 50).await.unwrap(),
        vec![first]
    );
}

#[tokio::test]
async fn changed_data_at_one_location_is_a_new_version_listed_newest_first() {
    let store = SqliteStore::in_memory().await.unwrap();
    let old: sprisk_contracts::DatasetVersion = fixture("dataset_version", "local-csv.json");
    let mut new = old.clone();
    new.id = "dsv_01JABCDEFGHJKMNPQRSTVWXYZ9".parse().unwrap();
    new.fingerprint = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
        .parse()
        .unwrap();
    store.insert_dataset_version(&old).await.unwrap();
    store.insert_dataset_version(&new).await.unwrap();

    let listed = store.list_dataset_versions(None, 50).await.unwrap();
    assert_eq!(listed, vec![new.clone(), old.clone()]);
    let before = store
        .list_dataset_versions(Some(&new.id), 50)
        .await
        .unwrap();
    assert_eq!(before, vec![old]);
}

#[tokio::test]
async fn an_unknown_dataset_version_is_not_found() {
    let store = SqliteStore::in_memory().await.unwrap();
    let missing = store
        .get_dataset_version(&"dsv_01JABCDEFGHJKMNPQRSTVWXYZ0".parse().unwrap())
        .await;
    assert!(
        matches!(missing, Err(StoreError::NotFound { .. })),
        "{missing:?}"
    );
}
