#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sprisk_api::{AppState, router};
use sprisk_artifacts::ArtifactStore;
use sprisk_registry::Registry;
use sprisk_scheduler::Settings;
use sprisk_store::SqliteStore;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

struct Api {
    _dir: tempfile::TempDir,
    app: Router,
    csv: PathBuf,
}

async fn api() -> Api {
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("d.csv");
    std::fs::write(&csv, "x,y\n1,2\n3,4\n").unwrap();
    let root = root();
    let gate = Registry::load_dir(&root.join("methodology"))
        .unwrap()
        .get("sprisk.methodology.supervised@1.0.0")
        .unwrap()
        .clone();
    let state = AppState {
        store: Arc::new(SqliteStore::in_memory().await.unwrap()),
        artifacts: Arc::new(ArtifactStore::local(&dir.path().join("store")).unwrap()),
        registry: Arc::new(Registry::load_dir(&root.join("plugins")).unwrap()),
        gate: Some(gate),
        worker_command: vec![
            root.join(".venv/bin/python").display().to_string(),
            "-m".into(),
            "sprisk_workers".into(),
            "--plugins-root".into(),
            root.join("plugins").display().to_string(),
            "--plugins-root".into(),
            root.join("methodology").display().to_string(),
        ],
        settings: Settings::default(),
    };
    Api {
        _dir: dir,
        app: router(state),
        csv,
    }
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    use tower::ServiceExt;
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(body.map_or(Body::empty(), |b| Body::from(b.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, json)
}

fn pipeline(csv: &Path) -> Value {
    json!({
        "schema_version": "sprisk.pipeline_version/v1",
        "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "nodes": [{"id": "load", "operator": "sprisk.io.file_source@1.0.0",
                   "params": {"path": csv, "format": "csv"}}],
        "edges": [],
        "created_at": "2026-10-16T10:00:00Z"
    })
}

#[tokio::test]
async fn pipeline_version_is_compiled_then_stored() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body, pipeline(&api.csv));

    let (status, _) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "versions are immutable");
}

#[tokio::test]
async fn pipeline_that_fails_gate_a_lists_every_error() {
    let api = api().await;
    let mut bad = pipeline(&api.csv);
    bad["nodes"] = json!([
        {"id": "a", "operator": "sprisk.nope.op@1.0.0", "params": {}},
        {"id": "b", "operator": "sprisk.nope.op@1.0.0", "params": {}}
    ]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(bad)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let codes: Vec<_> = body["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["code"].clone())
        .collect();
    assert_eq!(
        codes,
        [json!("unknown_operator"), json!("unknown_operator")]
    );
}

#[tokio::test]
async fn body_that_is_not_a_pipeline_version_is_rejected() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(json!({"nodes": null})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "invalid_body");
}

#[tokio::test]
async fn unknown_ids_are_not_found() {
    let api = api().await;
    let missing_run = "/runs/run_01JABCDEFGHJKMNPQRSTVWXYZ9";
    assert_eq!(
        call(&api.app, "GET", missing_run, None).await.0,
        StatusCode::NOT_FOUND
    );
    let body = json!({"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ9"});
    assert_eq!(
        call(&api.app, "POST", "/runs", Some(body)).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&api.app, "GET", "/runs/not-an-id", None).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn run_executes_in_the_background_and_reports_attempts_and_outputs() {
    let api = api().await;
    call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let create = json!({"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"});
    let (status, run) = call(&api.app, "POST", "/runs", Some(create)).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let run_uri = format!("/runs/{}", run["id"].as_str().unwrap());

    // The run happens in a real Python worker; poll its status, bounded.
    let mut finished = Value::Null;
    for _ in 0..200 {
        let (_, body) = call(&api.app, "GET", &run_uri, None).await;
        if body["status"] == "succeeded" || body["status"] == "failed" {
            finished = body;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(finished["status"], "succeeded", "{finished}");

    let (_, attempts) = call(&api.app, "GET", &format!("{run_uri}/attempts"), None).await;
    let nodes: Vec<_> = attempts
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["node_id"].clone())
        .collect();
    assert_eq!(nodes, [json!("gate_b"), json!("load")]);
    let load = attempts[1]["id"].as_str().unwrap();
    let (_, outputs) = call(&api.app, "GET", &format!("/attempts/{load}/outputs"), None).await;
    assert_eq!(outputs[0]["port"], "data");
    let artifact = outputs[0]["artifact"]["id"].as_str().unwrap();
    let (status, _) = call(&api.app, "GET", &format!("/artifacts/{artifact}"), None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn unknown_artifact_content_is_not_found() {
    let api = api().await;
    let uri = "/artifacts/art_01JABCDEFGHJKMNPQRSTVWXYZ9/content";
    assert_eq!(
        call(&api.app, "GET", uri, None).await.0,
        StatusCode::NOT_FOUND
    );
}
