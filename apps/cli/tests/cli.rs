#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use sprisk_cli::{Client, ServeConfig, pipeline_from_yaml, serve_on};
use sprisk_contracts::RunStatus;

const NOW: &str = "2026-10-16T10:00:00Z";

#[test]
fn yaml_without_ids_gets_new_ids_and_the_local_project() {
    let yaml = "nodes:\n  - { id: load, operator: sprisk.io.file_source@1.0.0, params: { path: /d.csv, format: csv } }\nedges: []\n";
    let pipeline = pipeline_from_yaml(yaml, NOW).unwrap();
    assert!(pipeline.id.as_str().starts_with("plv_"));
    assert_eq!(pipeline.project_id.as_str(), sprisk_cli::LOCAL_PROJECT);
    assert_eq!(pipeline.created_at.as_str(), NOW);
}

#[test]
fn yaml_ids_are_kept() {
    let yaml = "id: plv_01JABCDEFGHJKMNPQRSTVWXYZ0\nproject_id: prj_01JABCDEFGHJKMNPQRSTVWXYZ0\nnodes: []\nedges: []\n";
    let pipeline = pipeline_from_yaml(yaml, NOW).unwrap();
    assert_eq!(pipeline.id.as_str(), "plv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    assert_eq!(
        pipeline.project_id.as_str(),
        "prj_01JABCDEFGHJKMNPQRSTVWXYZ0"
    );
}

#[test]
fn yaml_that_is_not_a_pipeline_is_an_error() {
    let err = pipeline_from_yaml("nodes: 3\n", NOW).unwrap_err();
    assert!(err.to_string().contains("pipeline"), "{err}");
    assert!(pipeline_from_yaml("- just\n- a list\n", NOW).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn run_command_submits_waits_and_reports_through_the_api() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("d.csv");
    std::fs::write(&csv, "x,y\n1,2\n3,4\n").unwrap();
    let config = ServeConfig::for_repo(&root, &dir.path().join("data"), dir.path());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(serve_on(listener, config));

    let yaml = format!(
        "nodes:\n  - {{ id: load, operator: sprisk.io.file_source@1.0.0, params: {{ path: {}, format: csv }} }}\nedges: []\n",
        csv.display()
    );
    let client = Client::new(&base);
    let pipeline = pipeline_from_yaml(&yaml, NOW).unwrap();
    let run = client.submit_and_start(&pipeline).await.unwrap();
    let run = client
        .wait(&run.id, std::time::Duration::from_secs(60))
        .await
        .unwrap();
    assert_eq!(run.status, RunStatus::Succeeded);

    let report = client.report(&run.id).await.unwrap();
    assert!(report.contains("gate_b"), "{report}");
    assert!(report.contains("load"), "{report}");
    assert!(report.contains("succeeded"), "{report}");
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_pipeline_reports_every_gate_a_error() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(serve_on(
        listener,
        ServeConfig::for_repo(&root, &dir.path().join("data"), dir.path()),
    ));

    let yaml = "nodes:\n  - { id: a, operator: sprisk.nope.op@1.0.0, params: {} }\nedges: []\n";
    let err = Client::new(&base)
        .submit_and_start(&pipeline_from_yaml(yaml, NOW).unwrap())
        .await
        .unwrap_err();
    assert!(err.to_string().contains("unknown_operator"), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn resubmitting_an_id_with_different_content_is_refused() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("d.csv");
    std::fs::write(&csv, "x\n1\n").unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(serve_on(
        listener,
        ServeConfig::for_repo(&root, &dir.path().join("data"), dir.path()),
    ));
    let yaml = |format: &str| {
        format!(
            "id: plv_01JABCDEFGHJKMNPQRSTVWXYZ0\nnodes:\n  - {{ id: load, operator: sprisk.io.file_source@1.0.0, params: {{ path: {}, format: {format} }} }}\nedges: []\n",
            csv.display()
        )
    };
    let client = Client::new(&base);
    client
        .submit_and_start(&pipeline_from_yaml(&yaml("csv"), NOW).unwrap())
        .await
        .unwrap();
    // Same content again is fine: versions are immutable and identical.
    client
        .submit_and_start(&pipeline_from_yaml(&yaml("csv"), NOW).unwrap())
        .await
        .unwrap();

    let err = client
        .submit_and_start(&pipeline_from_yaml(&yaml("parquet"), NOW).unwrap())
        .await
        .unwrap_err();
    assert!(err.to_string().contains("different content"), "{err}");
}

#[test]
fn serve_refuses_non_loopback_addresses_until_auth_exists() {
    assert!(sprisk_cli::loopback_addr("127.0.0.1:7420").is_ok());
    assert!(sprisk_cli::loopback_addr("[::1]:7420").is_ok());
    assert!(sprisk_cli::loopback_addr("0.0.0.0:7420").is_err());
    assert!(sprisk_cli::loopback_addr("192.168.1.5:7420").is_err());
}
