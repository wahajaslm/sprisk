#![allow(clippy::unwrap_used, clippy::expect_used)]

//! The real Python worker as a child process, end to end for one source step.

use std::path::Path;

use serde_json::json;
use sprisk_artifacts::ArtifactStore;
use sprisk_contracts::{PipelineVersion, Run, RunStatus, parse};
use sprisk_graph::compile;
use sprisk_registry::Registry;
use sprisk_scheduler::{ProcessWorkers, Scheduler, Settings};
use sprisk_store::SqliteStore;

#[tokio::test]
async fn source_step_runs_in_the_python_worker_and_commits_parquet() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let python = root.join(".venv/bin/python");
    assert!(
        python.exists(),
        "run `uv sync` first: {} missing",
        python.display()
    );
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("d.csv");
    std::fs::write(&csv, "x,y\n1,2\n3,4\n").unwrap();

    let pipeline: PipelineVersion = parse(
        &json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [{"id": "load", "operator": "sprisk.io.file_source@1.0.0",
                       "params": {"path": csv, "format": "csv"}}],
            "edges": [],
            "created_at": "2026-10-16T10:00:00Z"
        })
        .to_string(),
    )
    .unwrap();
    let plan = compile(
        &pipeline,
        &Registry::load_dir(&root.join("plugins")).unwrap(),
    )
    .unwrap();
    let store = SqliteStore::in_memory().await.unwrap();
    let run: Run = parse(
        &json!({"schema_version": "sprisk.run/v1", "id": "run_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "status": "queued", "created_at": "2026-10-16T10:00:00Z"})
        .to_string(),
    )
    .unwrap();
    store.insert_run(&run).await.unwrap();
    let artifacts = ArtifactStore::local(&dir.path().join("store")).unwrap();
    let workers = ProcessWorkers {
        command: vec![
            python.display().to_string(),
            "-m".into(),
            "sprisk_workers".into(),
            "--plugins-root".into(),
            root.join("plugins").display().to_string(),
        ],
    };

    let status = Scheduler::new(&store, &artifacts, workers, Settings::default())
        .run(&run.id, &plan)
        .await
        .unwrap();

    assert_eq!(status, RunStatus::Succeeded);
    let attempts = store.list_attempts(&run.id).await.unwrap();
    let outputs = store.outputs(&attempts[0].id).await.unwrap();
    assert_eq!(outputs.len(), 1);
    let (port, artifact) = &outputs[0];
    assert_eq!(port, "data");
    assert_eq!(
        artifact.media_type.as_str(),
        "application/vnd.apache.parquet"
    );
    let bytes = artifacts.get(artifact.content_hash.as_str()).await.unwrap();
    assert_eq!(&bytes[..4], b"PAR1");
}
