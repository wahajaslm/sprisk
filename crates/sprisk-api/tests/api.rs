#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sprisk_api::{AppState, Splitter, router};
use sprisk_artifacts::ArtifactStore;
use sprisk_contracts::{OperatorSource, parse};
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
    api_with_python(root().join(".venv/bin/python")).await
}

async fn api_with_python(python: PathBuf) -> Api {
    let splitter = Splitter {
        command: vec![
            python.display().to_string(),
            "-m".into(),
            "sprisk_code.cells".into(),
        ],
        timeout: Duration::from_secs(30),
    };
    api_with(python, splitter).await
}

async fn api_with(python: PathBuf, splitter: Splitter) -> Api {
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
            python.display().to_string(),
            "-m".into(),
            "sprisk_workers".into(),
            "--plugins-root".into(),
            root.join("plugins").display().to_string(),
            "--plugins-root".into(),
            root.join("methodology").display().to_string(),
        ],
        settings: Settings::default(),
        idle_worker: Default::default(),
        data_roots: vec![dir.path().canonicalize().unwrap()],
        splitter,
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
        .header("host", "127.0.0.1:7420")
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

    let rows = format!("/artifacts/{artifact}/rows");
    let (status, page) = call(&api.app, "GET", &format!("{rows}?offset=1&limit=5"), None).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["total_rows"], 2);
    assert_eq!(page["columns"][0]["name"], "x");
    assert_eq!(page["rows"], json!([{"values": ["3", "4"], "missing": []}]));

    let (status, body) = call(&api.app, "GET", &format!("{rows}?offset=-1"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_offset");

    let gate = attempts[0]["id"].as_str().unwrap();
    let (_, gate_outputs) = call(&api.app, "GET", &format!("/attempts/{gate}/outputs"), None).await;
    let checks = gate_outputs[0]["artifact"]["id"].as_str().unwrap();
    let (status, body) = call(&api.app, "GET", &format!("/artifacts/{checks}/rows"), None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "not_a_table");
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

#[tokio::test(flavor = "multi_thread")]
async fn run_whose_worker_cannot_start_ends_failed() {
    let api = api_with_python(PathBuf::from("/nonexistent/python")).await;
    call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let create = json!({"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"});
    let (_, run) = call(&api.app, "POST", "/runs", Some(create)).await;
    let run_uri = format!("/runs/{}", run["id"].as_str().unwrap());
    let mut status = Value::Null;
    for _ in 0..100 {
        status = call(&api.app, "GET", &run_uri, None).await.1["status"].clone();
        if status == "failed" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(status, "failed");
}

#[tokio::test]
async fn reserved_node_id_is_refused_at_submit() {
    let api = api().await;
    let mut bad = pipeline(&api.csv);
    bad["nodes"][0]["id"] = json!("gate_b");
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(bad)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "reserved_node_id");
}

#[tokio::test]
async fn source_path_outside_the_data_roots_is_refused() {
    let api = api().await;
    let outside = tempfile::NamedTempFile::new().unwrap();
    let mut p = pipeline(&api.csv);
    p["nodes"][0]["params"]["path"] = json!(outside.path());
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(p)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "path_outside_data_roots");
}

#[cfg(unix)]
#[tokio::test]
async fn symlink_inside_a_root_pointing_outside_is_refused() {
    let api = api().await;
    let outside = tempfile::NamedTempFile::new().unwrap();
    let link = api.csv.with_file_name("link.csv");
    std::os::unix::fs::symlink(outside.path(), &link).unwrap();
    let mut p = pipeline(&api.csv);
    p["nodes"][0]["params"]["path"] = json!(link);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(p)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "path_outside_data_roots");
}

#[tokio::test]
async fn request_for_a_non_local_host_is_refused() {
    // Blocks DNS rebinding: a web page cannot reach the API under its own host name.
    use tower::ServiceExt;
    let api = api().await;
    for host in [Some("evil.example:7420"), None] {
        let mut request = Request::builder().uri("/runs/run_01JABCDEFGHJKMNPQRSTVWXYZ9");
        if let Some(host) = host {
            request = request.header("host", host);
        }
        let response = api
            .app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{host:?}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn artifact_content_is_served_as_a_download_never_rendered() {
    use tower::ServiceExt;
    let api = api().await;
    call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let create = json!({"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"});
    let (_, run) = call(&api.app, "POST", "/runs", Some(create)).await;
    let run_uri = format!("/runs/{}", run["id"].as_str().unwrap());
    for _ in 0..200 {
        if call(&api.app, "GET", &run_uri, None).await.1["status"] == "succeeded" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let (_, attempts) = call(&api.app, "GET", &format!("{run_uri}/attempts"), None).await;
    let load = attempts[1]["id"].as_str().unwrap();
    let (_, outputs) = call(&api.app, "GET", &format!("/attempts/{load}/outputs"), None).await;
    let artifact = outputs[0]["artifact"]["id"].as_str().unwrap();
    let request = Request::builder()
        .uri(format!("/artifacts/{artifact}/content"))
        .header("host", "localhost:7420")
        .body(Body::empty())
        .unwrap();
    let response = api.app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers();
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert!(
        headers["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment")
    );
}

#[tokio::test]
async fn operators_are_listed_for_the_step_library() {
    let api = api().await;
    let (status, body) = call(&api.app, "GET", "/operators", None).await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<_> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].clone())
        .collect();
    assert!(ids.contains(&json!("sprisk.clean.impute@1.0.0")));
    assert!(
        !ids.contains(&json!("sprisk.methodology.supervised@1.0.0")),
        "gate is not a step"
    );
}

#[tokio::test]
async fn pipeline_versions_and_runs_are_listed_newest_first() {
    let api = api().await;
    call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let (status, versions) = call(&api.app, "GET", "/pipeline_versions?limit=5", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(versions[0]["id"], "plv_01JABCDEFGHJKMNPQRSTVWXYZ0");

    let create = json!({"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"});
    let (_, run) = call(&api.app, "POST", "/runs", Some(create)).await;
    let uri = "/runs?pipeline_version_id=plv_01JABCDEFGHJKMNPQRSTVWXYZ0&limit=5";
    let (status, runs) = call(&api.app, "GET", uri, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(runs[0]["id"], run["id"]);
}

#[tokio::test]
async fn bad_list_parameters_are_rejected() {
    let api = api().await;
    for (uri, code) in [
        ("/runs?limit=100000", "invalid_limit"),
        ("/runs?limit=0", "invalid_limit"),
        ("/runs?limit=abc", "invalid_limit"),
        ("/runs?pipeline_version_id=bogus", "invalid_id"),
        ("/pipeline_versions?before=bogus", "invalid_id"),
    ] {
        let (status, body) = call(&api.app, "GET", uri, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(body["errors"][0]["code"], code, "{uri}");
    }
}

#[tokio::test]
async fn request_from_a_non_local_origin_is_refused() {
    use tower::ServiceExt;
    let api = api().await;
    for (origin, expected) in [
        ("https://evil.example", StatusCode::FORBIDDEN),
        ("null", StatusCode::FORBIDDEN),
        ("http://localhost:5173", StatusCode::NOT_FOUND),
        ("http://127.0.0.1:5173", StatusCode::NOT_FOUND),
    ] {
        let request = Request::builder()
            .uri("/runs/run_01JABCDEFGHJKMNPQRSTVWXYZ9")
            .header("host", "127.0.0.1:7420")
            .header("origin", origin)
            .body(Body::empty())
            .unwrap();
        let response = api.app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), expected, "{origin}");
    }
}

#[tokio::test]
async fn edited_version_must_name_an_existing_parent() {
    let api = api().await;
    let mut child = pipeline(&api.csv);
    child["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ1");
    child["parent_id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ0");

    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(child.clone())).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "unknown_parent");

    call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(child)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn an_operators_source_can_be_read() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "GET",
        "/operators/sprisk.clean.impute@1.0.0/source",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let source: OperatorSource = parse(&body.to_string()).unwrap();
    assert_eq!(source.path, "sprisk_clean/impute.py");
    assert!(source.text.contains("def impute("));
}

#[tokio::test]
async fn source_of_an_unknown_operator_is_not_found() {
    let api = api().await;
    let (status, body) = call(&api.app, "GET", "/operators/acme.io.csv@0.1.0/source", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_can_reuse_an_earlier_run_which_must_exist() {
    let api = api().await;
    let (_, version) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let id = version["id"].clone();
    let missing =
        json!({"pipeline_version_id": id, "reuse_run_id": "run_01JABCDEFGHJKMNPQRSTVWXYZ9"});
    assert_eq!(
        call(&api.app, "POST", "/runs", Some(missing)).await.0,
        StatusCode::NOT_FOUND
    );

    let (_, first) = call(
        &api.app,
        "POST",
        "/runs",
        Some(json!({"pipeline_version_id": id})),
    )
    .await;
    let again = json!({"pipeline_version_id": id, "reuse_run_id": first["id"]});
    let (status, second) = call(&api.app, "POST", "/runs", Some(again)).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{second}");
    assert_eq!(second["reuse_run_id"], first["id"]);
}

#[tokio::test]
async fn notebook_cells_are_split_into_linked_steps() {
    let api = api().await;
    let cells = json!({"cells": ["df = load()", "n = len(df)"]});
    let (status, split) = call(&api.app, "POST", "/code/split", Some(cells)).await;
    assert_eq!(status, StatusCode::OK, "{split}");
    assert_eq!(split["steps"].as_array().unwrap().len(), 2);
    assert_eq!(
        split["links"],
        json!([{"from_step": 0, "to_step": 1, "name": "df"}])
    );
}

async fn split_with(command: &[&str], timeout: Duration) -> (StatusCode, Value) {
    let splitter = Splitter {
        command: command.iter().map(|c| (*c).to_owned()).collect(),
        timeout,
    };
    let api = api_with(root().join(".venv/bin/python"), splitter).await;
    let cells = json!({"cells": ["a = 1"]});
    call(&api.app, "POST", "/code/split", Some(cells)).await
}

#[tokio::test]
async fn a_failing_splitter_is_an_error_with_its_message() {
    let (status, body) = split_with(
        &["sh", "-c", "echo broken >&2; exit 3"],
        Duration::from_secs(5),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body.to_string().contains("broken"), "{body}");
}

#[tokio::test]
async fn a_slow_splitter_is_stopped() {
    let (status, body) = split_with(&["sleep", "5"], Duration::from_millis(200)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "split_timeout");
}

#[tokio::test]
async fn too_many_cells_are_refused_before_python_starts() {
    let api = api().await;
    let cells = json!({"cells": vec!["a = 1"; 1001]});
    let (status, body) = call(&api.app, "POST", "/code/split", Some(cells)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "too_many_cells");
}
