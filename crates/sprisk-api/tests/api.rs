#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sprisk_api::{AppState, KernelLimits, Kernels, Profiler, Splitter, router};
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
    kernels: Kernels,
    store: Arc<SqliteStore>,
}

const KERNEL_LIMITS: KernelLimits = KernelLimits {
    cell_seconds: 20,
    memory_mb: 2048,
    idle: Duration::from_secs(600),
    at_once: 2,
};

async fn api() -> Api {
    api_with_python(root().join(".venv/bin/python")).await
}

async fn api_with_python(python: PathBuf) -> Api {
    let command = vec![
        python.display().to_string(),
        "-m".into(),
        "sprisk_code.cells".into(),
    ];
    api_with(python, Splitter::new(command, Duration::from_secs(30), 2)).await
}

async fn api_with(python: PathBuf, splitter: Splitter) -> Api {
    api_with_kernels(python, splitter, KERNEL_LIMITS).await
}

async fn api_with_kernels(python: PathBuf, splitter: Splitter, limits: KernelLimits) -> Api {
    let host = session_host(&python);
    api_with_kernel_host(python, splitter, limits, host).await
}

fn session_host(python: &Path) -> Vec<String> {
    vec![
        python.display().to_string(),
        "-m".into(),
        "sprisk_code.session".into(),
    ]
}

async fn api_with_kernel_host(
    python: PathBuf,
    splitter: Splitter,
    limits: KernelLimits,
    host: Vec<String>,
) -> Api {
    let dir = tempfile::tempdir().unwrap();
    let kernels = Kernels::new(host, dir.path().to_owned(), limits);
    let csv = dir.path().join("d.csv");
    std::fs::write(&csv, "x,y\n1,2\n3,4\n").unwrap();
    let root = root();
    let gate = Registry::load_dir(&root.join("methodology"))
        .unwrap()
        .get("sprisk.methodology.supervised@1.0.0")
        .unwrap()
        .clone();
    let store = Arc::new(SqliteStore::in_memory().await.unwrap());
    let state = AppState {
        store: store.clone(),
        artifacts: Arc::new(ArtifactStore::local(&dir.path().join("store")).unwrap()),
        registry: Arc::new(Registry::load_dir(&root.join("plugins")).unwrap()),
        rules: Arc::new(
            sprisk_methodology::RuleCatalog::load_dir(&root.join("methodology")).unwrap(),
        ),
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
        rule_runner: sprisk_api::RuleRunner::new(
            vec![
                python.display().to_string(),
                "-m".into(),
                "sprisk_workers.rule".into(),
            ],
            Duration::from_secs(30),
            2,
        ),
        profiler: Profiler::new(
            vec![
                python.display().to_string(),
                "-m".into(),
                "sprisk_profile.dataset".into(),
            ],
            Duration::from_secs(30),
            2,
        ),
        kernels: kernels.clone(),
    };
    Api {
        _dir: dir,
        app: router(state),
        csv,
        kernels,
        store,
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

/// Runs the saved version in a real Python worker and waits, bounded, until it ends.
/// Returns the finished run (`Null` if it never ended) and its attempts.
async fn run_to_end(api: &Api) -> (Value, Value) {
    let create = json!({"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"});
    let (status, run) = call(&api.app, "POST", "/runs", Some(create)).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    let run_uri = format!("/runs/{}", run["id"].as_str().unwrap());
    let mut finished = Value::Null;
    for _ in 0..400 {
        let (_, body) = call(&api.app, "GET", &run_uri, None).await;
        if body["status"] == "succeeded" || body["status"] == "failed" {
            finished = body;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let (_, attempts) = call(&api.app, "GET", &format!("{run_uri}/attempts"), None).await;
    (finished, attempts)
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
    let (finished, attempts) = run_to_end(&api).await;
    assert_eq!(finished["status"], "succeeded", "{finished}");

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
    let (finished, _) = run_to_end(&api).await;
    assert_eq!(finished["status"], "failed", "{finished}");
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
    let (finished, attempts) = run_to_end(&api).await;
    assert_eq!(finished["status"], "succeeded", "{finished}");
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

async fn splitting_api(command: &[&str], timeout: Duration, running: usize) -> Api {
    let command = command.iter().map(|c| (*c).to_owned()).collect();
    api_with(
        root().join(".venv/bin/python"),
        Splitter::new(command, timeout, running),
    )
    .await
}

async fn split_with(command: &[&str], timeout: Duration) -> (StatusCode, Value) {
    let api = splitting_api(command, timeout, 2).await;
    let cells = json!({"cells": ["a = 1"]});
    call(&api.app, "POST", "/code/split", Some(cells)).await
}

#[tokio::test]
async fn a_failing_splitter_is_an_error_that_does_not_echo_its_output() {
    let (status, body) = split_with(
        &["sh", "-c", "echo /secret/path >&2; exit 3"],
        Duration::from_secs(5),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!body.to_string().contains("/secret/path"), "{body}");
    assert!(body.to_string().contains("exit status: 3"), "{body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn splits_beyond_the_limit_are_refused_while_others_run() {
    let api = splitting_api(&["sleep", "1"], Duration::from_secs(5), 1).await;
    let cells = json!({"cells": ["a = 1"]});
    let (first, second) = tokio::join!(
        call(&api.app, "POST", "/code/split", Some(cells.clone())),
        async {
            tokio::time::sleep(Duration::from_millis(200)).await;
            call(&api.app, "POST", "/code/split", Some(cells.clone())).await
        }
    );
    assert_eq!(
        first.0,
        StatusCode::INTERNAL_SERVER_ERROR,
        "sleep prints no split"
    );
    assert_eq!(second.0, StatusCode::TOO_MANY_REQUESTS, "{}", second.1);
    assert_eq!(second.1["errors"][0]["code"], "split_busy");
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

/// The first slice of ADR-0031: notebook cells become linked steps that run.
#[tokio::test(flavor = "multi_thread")]
async fn notebook_cells_become_a_flow_that_runs() {
    let api = api().await;
    let csv = api.csv.display().to_string();
    let cells = json!({"cells": [
        "import pandas as pd",
        format!("df = pd.read_csv({csv:?})"),
        "min_x = 2\nkept = df[df['x'] >= min_x]\nprint(len(kept))",
        "kept.describe()",
    ]});
    let (status, split) = call(&api.app, "POST", "/code/split", Some(cells)).await;
    assert_eq!(status, StatusCode::OK, "{split}");
    let ids: Vec<String> = (1..=split["steps"].as_array().unwrap().len())
        .map(|i| format!("cell_{i}"))
        .collect();
    let nodes: Vec<Value> = split["steps"]
        .as_array()
        .unwrap()
        .iter()
        .zip(&ids)
        .map(|(step, id)| {
            json!({"id": id, "operator": "sprisk.code.python@2.0.0", "params": {
                "source": step["source"], "inputs": step["inputs"], "outputs": step["outputs"]}})
        })
        .collect();
    let edges: Vec<Value> = split["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            let (from, to, name) = (&l["from_step"], &l["to_step"], l["name"].as_str().unwrap());
            json!({"from": format!("{}.{name}", ids[from.as_u64().unwrap() as usize]),
                   "to": format!("{}.{name}", ids[to.as_u64().unwrap() as usize])})
        })
        .collect();
    let mut version = pipeline(&api.csv);
    version["nodes"] = json!(nodes);
    version["edges"] = json!(edges);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(version)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (finished, attempts) = run_to_end(&api).await;
    assert_eq!(finished["status"], "succeeded", "{finished} {attempts}");
    let filter = attempts
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["node_id"] == "cell_2")
        .unwrap();
    let uri = format!("/attempts/{}/outputs", filter["id"].as_str().unwrap());
    let (_, outputs) = call(&api.app, "GET", &uri, None).await;
    let kept = outputs
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["port"] == "kept")
        .unwrap();
    let rows = format!(
        "/artifacts/{}/rows",
        kept["artifact"]["id"].as_str().unwrap()
    );
    let (_, page) = call(&api.app, "GET", &rows, None).await;
    assert_eq!(page["total_rows"], 1, "{page}");
}

const NOTEBOOK: &str = "nb_01JABCDEFGHJKMNPQRSTVWXYZ0";

fn notebook_version(id: &str, notebook: &str, parent: Option<&str>) -> Value {
    let mut version = json!({
        "schema_version": "sprisk.notebook_version/v1",
        "id": id,
        "notebook_id": notebook,
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "title": "Sales",
        "cells": [{"id": "c1", "kind": "code", "source": "x = 1"}],
        "created_at": "2026-10-18T10:00:00Z"
    });
    if let Some(parent) = parent {
        version["parent_id"] = json!(parent);
    }
    version
}

async fn api_with_notebook(limits: KernelLimits) -> Api {
    api_with_notebook_host(limits, session_host(&root().join(".venv/bin/python"))).await
}

async fn api_with_notebook_host(limits: KernelLimits, host: Vec<String>) -> Api {
    let python = root().join(".venv/bin/python");
    let splitter = Splitter::new(vec![], Duration::from_secs(1), 1);
    let api = api_with_kernel_host(python, splitter, limits, host).await;
    let first = notebook_version("nbv_01JABCDEFGHJKMNPQRSTVWXYZ0", NOTEBOOK, None);
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(first)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    api
}

async fn execute(api: &Api, notebook: &str, code: &str) -> (StatusCode, Value) {
    let uri = format!("/notebooks/{notebook}/execute");
    call(
        &api.app,
        "POST",
        &uri,
        Some(json!({"cell_id": "c1", "code": code})),
    )
    .await
}

#[tokio::test]
async fn notebook_versions_are_saved_and_each_notebooks_latest_is_listed() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let second = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        NOTEBOOK,
        Some("nbv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    let (status, _) = call(&api.app, "POST", "/notebook_versions", Some(second.clone())).await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, listed) = call(&api.app, "GET", "/notebooks", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed, json!([second.clone()]));
    let uri = "/notebook_versions/nbv_01JABCDEFGHJKMNPQRSTVWXYZ1";
    assert_eq!(call(&api.app, "GET", uri, None).await.1, second);
}

#[tokio::test]
async fn a_notebook_version_must_be_saved_over_a_version_of_the_same_notebook() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let missing = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        NOTEBOOK,
        Some("nbv_01JABCDEFGHJKMNPQRSTVWXYZ9"),
    );
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(missing)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "unknown_parent");

    let other = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ2",
        "nb_01JABCDEFGHJKMNPQRSTVWXYZ1",
        Some("nbv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(other)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "parent_in_other_notebook");
}

#[tokio::test]
async fn a_deleted_notebook_is_not_listed_and_its_history_stays_readable() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let mut removed = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        NOTEBOOK,
        Some("nbv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    removed["removed"] = json!(true);
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(removed)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (status, listed) = call(&api.app, "GET", "/notebooks", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed, json!([]));
    let uri = "/notebook_versions/nbv_01JABCDEFGHJKMNPQRSTVWXYZ0";
    assert_eq!(call(&api.app, "GET", uri, None).await.0, StatusCode::OK);
}

#[tokio::test]
async fn only_a_notebook_that_exists_can_be_deleted() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let mut removed = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        "nb_01JABCDEFGHJKMNPQRSTVWXYZ1",
        None,
    );
    removed["removed"] = json!(true);
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(removed)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["errors"][0]["code"], "removed_without_parent");
}

#[tokio::test(flavor = "multi_thread")]
async fn cells_of_a_notebook_share_one_kernel_and_each_run_is_audited() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let (status, first) = execute(
        &api,
        NOTEBOOK,
        "import pandas as pd\nsales = pd.DataFrame({'a': [1]})",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (_, second) = execute(&api, NOTEBOOK, "len(sales)").await;
    assert_eq!(second["status"], "ok", "{second}");
    assert_eq!(second["outputs"], json!([{"kind": "text", "text": "1"}]));

    let uri = format!("/notebooks/{NOTEBOOK}/variables?names=sales,later");
    let (status, found) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(found["variables"][0]["table"], true);
    assert_eq!(found["variables"][1]["defined"], false);

    let events: Vec<String> = api
        .store
        .audit_events(NOTEBOOK)
        .await
        .unwrap()
        .into_iter()
        .map(|(_, event)| event)
        .collect();
    assert_eq!(events.len(), 4, "{events:?}");
    assert!(
        events[0].starts_with("cell c1 started, code sha256:"),
        "{events:?}"
    );
    assert!(
        events[1].starts_with("cell c1 ended: ok, execution "),
        "{events:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn restart_clears_the_kernels_variables() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    execute(&api, NOTEBOOK, "kept = 1").await;
    let uri = format!("/notebooks/{NOTEBOOK}/restart");
    let (status, _) = call(&api.app, "POST", &uri, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, after) = execute(&api, NOTEBOOK, "'kept' in dir()").await;
    assert_eq!(after["outputs"][0]["text"], "False", "{after}");
}

#[tokio::test(flavor = "multi_thread")]
async fn interrupt_stops_the_running_cell_without_waiting_behind_it() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    execute(&api, NOTEBOOK, "import pathlib, time").await;
    let app = api.app.clone();
    let started = api._dir.path().join("started");
    let interrupt = tokio::spawn(async move {
        // Interrupt once the cell has started, never by guessing how long that takes.
        while !started.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let uri = format!("/notebooks/{NOTEBOOK}/interrupt");
        call(&app, "POST", &uri, None).await.0
    });
    let cell = "pathlib.Path('started').touch()\ntime.sleep(30)";
    let (_, done) = execute(&api, NOTEBOOK, cell).await;
    assert_eq!(interrupt.await.unwrap(), StatusCode::NO_CONTENT);
    assert_eq!(done["status"], "interrupted", "{done}");
}

#[tokio::test(flavor = "multi_thread")]
async fn kernels_beyond_the_limit_are_refused() {
    let limits = KernelLimits {
        at_once: 1,
        ..KERNEL_LIMITS
    };
    let api = api_with_notebook(limits).await;
    let other = "nb_01JABCDEFGHJKMNPQRSTVWXYZ1";
    let version = notebook_version("nbv_01JABCDEFGHJKMNPQRSTVWXYZ5", other, None);
    call(&api.app, "POST", "/notebook_versions", Some(version)).await;
    assert_eq!(execute(&api, NOTEBOOK, "1").await.0, StatusCode::OK);
    let (status, body) = execute(&api, other, "1").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["errors"][0]["code"], "too_many_kernels");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_idle_kernel_is_shut_down() {
    let limits = KernelLimits {
        idle: Duration::ZERO,
        ..KERNEL_LIMITS
    };
    let api = api_with_notebook(limits).await;
    execute(&api, NOTEBOOK, "kept = 1").await;
    api.kernels.shut_idle().await;
    let uri = format!("/notebooks/{NOTEBOOK}/variables?names=kept");
    let (_, found) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(found["variables"][0]["defined"], false, "{found}");
}

#[tokio::test]
async fn a_notebook_that_was_never_saved_cannot_run() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let (status, _) = execute(&api, "nb_01JABCDEFGHJKMNPQRSTVWXYZ7", "1").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn variable_names_must_be_port_names() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let uri = format!("/notebooks/{NOTEBOOK}/variables?names=__import__");
    let (status, body) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

/// A browser that gives up on a cell must not leave its late answer for the next request.
#[tokio::test(flavor = "multi_thread")]
async fn an_abandoned_request_does_not_answer_the_next_one() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let notebook: sprisk_contracts::NotebookId = NOTEBOOK.parse().unwrap();
    api.kernels.execute(&notebook, "import time").await.unwrap();
    let slow = api.kernels.execute(&notebook, "time.sleep(2)\n'slow'");
    assert!(
        tokio::time::timeout(Duration::from_millis(500), slow)
            .await
            .is_err()
    );
    let next = api.kernels.execute(&notebook, "'next'").await.unwrap();
    assert_eq!(next.outputs[0].text.as_deref(), Some("'next'"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cell_whose_kernel_dies_is_still_audited() {
    let python = root().join(".venv/bin/python").display().to_string();
    let host = vec![
        python,
        "-c".into(),
        "import sys; sys.stdin.readline()".into(),
    ];
    let api = api_with_notebook_host(KERNEL_LIMITS, host).await;
    let (status, body) = execute(&api, NOTEBOOK, "1").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    let events = api.store.audit_events(NOTEBOOK).await.unwrap();
    assert_eq!(events.len(), 2, "{events:?}");
    assert!(events[0].1.starts_with("cell c1 started, code sha256:"));
    assert!(
        events[1].1.starts_with("cell c1 ended: kernel stopped"),
        "{events:?}"
    );
}

fn node_from_notebook(api: &Api, from: Value) -> Value {
    let mut version = pipeline(&api.csv);
    version["nodes"][0]["from_notebook"] = from;
    version
}

async fn submit(api: &Api, version: Value) -> (StatusCode, Value) {
    call(&api.app, "POST", "/pipeline_versions", Some(version)).await
}

#[tokio::test]
async fn a_node_must_cite_saved_cells_of_a_notebook_in_its_project() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let saved = "nbv_01JABCDEFGHJKMNPQRSTVWXYZ0";
    let cases = [
        (
            json!({"notebook_version_id": "nbv_01JABCDEFGHJKMNPQRSTVWXYZ9", "cells": ["c1"]}),
            "unknown_notebook_version",
        ),
        (
            json!({"notebook_version_id": saved, "cells": ["c9"]}),
            "unknown_notebook_cell",
        ),
        (
            json!({"notebook_version_id": saved, "cells": []}),
            "no_notebook_cells",
        ),
    ];
    for (from, code) in cases {
        let (status, body) = submit(&api, node_from_notebook(&api, from)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["errors"][0]["code"], code);
    }
    let mut elsewhere = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ3",
        "nb_01JABCDEFGHJKMNPQRSTVWXYZ3",
        None,
    );
    elsewhere["project_id"] = json!("prj_01JABCDEFGHJKMNPQRSTVWXYZ9");
    call(&api.app, "POST", "/notebook_versions", Some(elsewhere)).await;
    let from = json!({"notebook_version_id": "nbv_01JABCDEFGHJKMNPQRSTVWXYZ3", "cells": ["c1"]});
    let (status, body) = submit(&api, node_from_notebook(&api, from)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "notebook_in_other_project");

    let from = json!({"notebook_version_id": saved, "cells": ["c1"]});
    let (status, body) = submit(&api, node_from_notebook(&api, from)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn a_notebook_keeps_its_project_and_its_one_first_version() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let mut moved = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        NOTEBOOK,
        Some("nbv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    moved["project_id"] = json!("prj_01JABCDEFGHJKMNPQRSTVWXYZ9");
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(moved)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "parent_in_other_project");

    let second_root = notebook_version("nbv_01JABCDEFGHJKMNPQRSTVWXYZ2", NOTEBOOK, None);
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(second_root)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn cells_kept_together_must_be_a_forward_range() {
    let api = api().await;
    let cells = json!({"cells": ["a = 1", "b = a"], "together": {"first": 1, "last": 0}});
    let (status, body) = call(&api.app, "POST", "/code/split", Some(cells)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_cell_range");
}

/// A canvas card previews a step's first figure; the tables the step showed stay here.
#[tokio::test(flavor = "multi_thread")]
async fn figures_of_a_code_step_come_without_its_tables() {
    let api = api().await;
    let source = "import pandas as pd\nimport plotly.graph_objects as go\n\
        display(pd.DataFrame({'a': [1, 2]}))\n\
        display(go.Figure(go.Bar(y=[1, 2])))\n\
        display(go.Figure(go.Bar(y=[3])))\n";
    let mut version = pipeline(&api.csv);
    version["nodes"] = json!([{"id": "draw", "operator": "sprisk.code.python@2.0.0",
        "params": {"source": source}}]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(version)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (finished, attempts) = run_to_end(&api).await;
    assert_eq!(finished["status"], "succeeded", "{finished} {attempts}");
    let draw = attempts
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["node_id"] == "draw")
        .unwrap();
    let uri = format!("/attempts/{}/outputs", draw["id"].as_str().unwrap());
    let (_, outputs) = call(&api.app, "GET", &uri, None).await;
    let artifact_of = |port: &str| {
        outputs
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["port"] == port)
            .unwrap()["artifact"]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let figures = format!("/artifacts/{}/figures", artifact_of("display"));

    let (status, set) = call(&api.app, "GET", &format!("{figures}?limit=1"), None).await;
    assert_eq!(status, StatusCode::OK, "{set}");
    assert_eq!(set["items"].as_array().unwrap().len(), 1, "{set}");
    assert_eq!(set["items"][0]["format"], "plotly_json");
    assert!(
        !set.to_string().contains("total_rows"),
        "a table came back: {set}"
    );

    let (status, body) = call(&api.app, "GET", &format!("{figures}?limit=0"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_limit");

    let interface = format!("/artifacts/{}/figures", artifact_of("interface"));
    let (status, body) = call(&api.app, "GET", &interface, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "not_figures");
}

#[tokio::test]
async fn a_node_naming_its_notebook_must_name_the_notebook_of_its_version() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let wrong = json!({"notebook_version_id": "nbv_01JABCDEFGHJKMNPQRSTVWXYZ0", "notebook_id": "nb_01JABCDEFGHJKMNPQRSTVWXYZ9", "cells": ["c1"]});
    let (status, body) = submit(&api, node_from_notebook(&api, wrong)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "wrong_notebook");
    let right = json!({"notebook_version_id": "nbv_01JABCDEFGHJKMNPQRSTVWXYZ0", "notebook_id": NOTEBOOK, "cells": ["c1"]});
    let (status, body) = submit(&api, node_from_notebook(&api, right)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn a_notebook_belongs_to_a_saved_flow_of_its_project() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let mut unknown = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        NOTEBOOK,
        Some("nbv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    unknown["pipeline_version_id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ9");
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(unknown)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "unknown_flow");

    let (status, _) = submit(&api, pipeline(&api.csv)).await;
    assert_eq!(status, StatusCode::CREATED);
    let mut linked = notebook_version(
        "nbv_01JABCDEFGHJKMNPQRSTVWXYZ2",
        NOTEBOOK,
        Some("nbv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    linked["pipeline_version_id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    let (status, body) = call(&api.app, "POST", "/notebook_versions", Some(linked)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

/// ADR-0038: the tables flows load, and a profile of one, without the table itself.
#[tokio::test(flavor = "multi_thread")]
async fn the_tables_flows_load_are_listed_and_one_is_profiled() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (finished, _) = run_to_end(&api).await;
    assert_eq!(finished["status"], "succeeded", "{finished}");

    let (status, datasets) = call(&api.app, "GET", "/loaded_tables", None).await;
    assert_eq!(status, StatusCode::OK, "{datasets}");
    assert_eq!(datasets.as_array().unwrap().len(), 1, "{datasets}");
    let d = &datasets[0];
    assert_eq!(
        (
            d["name"].as_str(),
            d["total_rows"].as_u64(),
            d["total_columns"].as_u64()
        ),
        (Some("d.csv"), Some(2), Some(2))
    );
    assert_eq!(
        d["used_by"],
        json!([{"pipeline_version_id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "run_id": finished["id"], "node_id": "load"}])
    );

    let profile = format!(
        "/artifacts/{}/profile",
        d["artifact"]["id"].as_str().unwrap()
    );
    let (status, body) = call(&api.app, "GET", &profile, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total_rows"], 2);
    assert_eq!(body["columns"][0]["name"], "x");
    assert_eq!(body["correlation"]["columns"], json!(["x", "y"]));
    assert_eq!(body["profiled_rows"], 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn only_a_table_can_be_profiled() {
    let api = api().await;
    call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let (_, attempts) = run_to_end(&api).await;
    let gate = attempts[0]["id"].as_str().unwrap();
    let (_, outputs) = call(&api.app, "GET", &format!("/attempts/{gate}/outputs"), None).await;
    let checks = outputs[0]["artifact"]["id"].as_str().unwrap();

    let (status, body) = call(
        &api.app,
        "GET",
        &format!("/artifacts/{checks}/profile"),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "not_a_table");
}

#[tokio::test]
async fn a_table_not_on_this_machine_is_not_profiled_yet() {
    let api = api().await;
    let mut artifact: sprisk_contracts::Artifact =
        parse(&fs_fixture("artifact", "parquet-with-schema.json")).unwrap();
    artifact.uri = "s3://bucket/t.parquet".parse().unwrap();
    api.store.insert_artifact(&artifact).await.unwrap();

    let uri = format!("/artifacts/{}/profile", artifact.id.as_str());
    let (status, body) = call(&api.app, "GET", &uri, None).await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "not_local");
}

fn fs_fixture(entity: &str, name: &str) -> String {
    std::fs::read_to_string(
        root()
            .join("tests/contract")
            .join(entity)
            .join("valid")
            .join(name),
    )
    .unwrap()
}

/// POSTs a cell asking for the stream (ADR-0041). Returns the status, each line as JSON, and
/// how long before the end the first bytes came.
async fn execute_streamed(api: &Api, code: &str) -> (StatusCode, Vec<Value>, Duration) {
    use tower::ServiceExt;
    let request = Request::builder()
        .method("POST")
        .uri(format!("/notebooks/{NOTEBOOK}/execute"))
        .header("content-type", "application/json")
        .header("accept", "application/x-ndjson")
        .header("host", "127.0.0.1:7420")
        .body(Body::from(
            json!({"cell_id": "c1", "code": code}).to_string(),
        ))
        .unwrap();
    let response = api.app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let mut body = response.into_body();
    let (mut bytes, mut first) = (Vec::new(), None);
    while let Some(frame) = body.frame().await {
        if let Ok(data) = frame.unwrap().into_data() {
            first.get_or_insert_with(std::time::Instant::now);
            bytes.extend_from_slice(&data);
        }
    }
    let ahead = first.map_or(Duration::ZERO, |t| t.elapsed());
    let text = String::from_utf8(bytes).unwrap();
    let lines = text
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    (status, lines, ahead)
}

#[tokio::test(flavor = "multi_thread")]
async fn asked_for_a_stream_a_running_cell_shows_its_output_as_it_comes() {
    let api = api_with_notebook(KERNEL_LIMITS).await;
    let code = "import time\nprint('first', flush=True)\ntime.sleep(2)\nprint('second')";

    let (status, lines, ahead) = execute_streamed(&api, code).await;

    assert_eq!(status, StatusCode::OK, "{lines:?}");
    let running = lines.iter().find(|l| l["kind"] == "running").unwrap();
    assert_eq!(running["outputs"][0]["text"], "first\n");
    let done = lines.last().unwrap();
    assert_eq!(done["kind"], "done");
    assert_eq!(done["execution"]["outputs"][0]["text"], "first\nsecond\n");
    assert!(
        ahead >= Duration::from_secs(1),
        "first bytes only {ahead:?} before the end"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_kernel_that_stops_mid_stream_ends_it_with_a_failure() {
    let python = root().join(".venv/bin/python").display().to_string();
    let host = vec![
        python,
        "-c".into(),
        "import sys; sys.stdin.readline(); print('{\"kind\": \"running\", \"outputs\": []}', flush=True)"
            .into(),
    ];
    let api = api_with_notebook_host(KERNEL_LIMITS, host).await;

    let (status, lines, _) = execute_streamed(&api, "1").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert_eq!(lines[1]["kind"], "failed");
    assert_eq!(lines[1]["problem"]["errors"][0]["code"], "kernel_stopped");
    let events = api.store.audit_events(NOTEBOOK).await.unwrap();
    assert!(
        events[1].1.starts_with("cell c1 ended: kernel stopped"),
        "{events:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_kernel_that_stops_before_any_output_is_an_http_error_even_when_streaming() {
    let python = root().join(".venv/bin/python").display().to_string();
    let host = vec![
        python,
        "-c".into(),
        "import sys; sys.stdin.readline()".into(),
    ];
    let api = api_with_notebook_host(KERNEL_LIMITS, host).await;

    let (status, lines, _) = execute_streamed(&api, "1").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{lines:?}");
    assert_eq!(lines[0]["errors"][0]["code"], "kernel_stopped");
}

fn question(id: &str, parent: Option<&str>) -> Value {
    let mut question = json!({
        "schema_version": "sprisk.question_version/v1",
        "id": id,
        "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "objective": {"value": "Predict which orders will be returned within 30 days.", "origin": "explicit"},
        "task": {"value": "classification", "origin": "explicit"},
        "target": {"value": "returned_within_30d", "origin": "explicit"},
        "unit_of_analysis": {"value": "order", "origin": "explicit"},
        "entity_column": {"value": "order_id", "origin": "explicit"},
        "time_column": {"value": "order_date", "origin": "explicit"},
        "prediction_horizon": {"value": "P30D", "origin": "explicit"},
        "assumptions": [{"value": "Return labels are complete after 30 days.", "origin": "explicit"}],
        "unknowns": [{"question": "Are exchanges counted as returns?", "blocks": "release"}],
        "acceptance_criteria": [{"value": "Average precision beats the dummy baseline on temporal validation.", "origin": "explicit"}],
        "created_at": "2026-10-19T10:00:00Z"
    });
    if let Some(parent) = parent {
        question["parent_id"] = json!(parent);
    }
    question
}

#[tokio::test]
async fn question_ledger_is_immutable_filterable_and_revision_checked() {
    let api = api().await;
    let first = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    let (status, created) = call(&api.app, "POST", "/question_versions", Some(first.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");

    let second = question(
        "qv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        Some("qv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    let (status, created) =
        call(&api.app, "POST", "/question_versions", Some(second.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");

    let (status, listed) = call(
        &api.app,
        "GET",
        "/question_versions?investigation_id=inv_01JABCDEFGHJKMNPQRSTVWXYZ0&limit=20",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    assert_eq!(listed, json!([second, first]));

    let (_, original) = call(
        &api.app,
        "GET",
        "/question_versions/qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        None,
    )
    .await;
    assert_eq!(original, first);

    let mut wrong = question(
        "qv_01JABCDEFGHJKMNPQRSTVWXYZ2",
        Some("qv_01JABCDEFGHJKMNPQRSTVWXYZ1"),
    );
    wrong["investigation_id"] = json!("inv_01JABCDEFGHJKMNPQRSTVWXYZ9");
    let (status, problem) = call(&api.app, "POST", "/question_versions", Some(wrong)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{problem}");
    assert_eq!(problem["errors"][0]["code"], "different_investigation");
}

#[tokio::test]
async fn a_flow_can_only_link_a_saved_question_revision() {
    let api = api().await;
    let mut linked = pipeline(&api.csv);
    linked["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    let (status, problem) =
        call(&api.app, "POST", "/pipeline_versions", Some(linked.clone())).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{problem}");
    assert_eq!(problem["errors"][0]["code"], "unknown_question_version");

    let question = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    let (status, _) = call(&api.app, "POST", "/question_versions", Some(question)).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, saved) = call(&api.app, "POST", "/pipeline_versions", Some(linked)).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(
        saved["question_version_id"],
        "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"
    );
}

#[tokio::test]
async fn split_methodology_is_resolved_previewed_and_applied_once() {
    let api = api().await;
    let q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    assert_eq!(
        call(&api.app, "POST", "/question_versions", Some(q))
            .await
            .0,
        StatusCode::CREATED
    );
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    flow["nodes"].as_array_mut().unwrap().push(json!({
        "id":"split", "operator":"sprisk.validation.random_split@1.0.0",
        "params":{"test_fraction":0.2,"seed":42,"stratify":"returned_within_30d"}
    }));
    flow["edges"] = json!([{"from":"load.data","to":"split.data"}]);
    let (status, _) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, proposal) = call(
        &api.app,
        "POST",
        "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ0/methodology/split/split/proposals",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(proposal["recommended_alternative_id"], "temporal");
    // Decided by methodology/supervised/rules/data_split/rule.py, not by Rust.
    assert_eq!(proposal["rule"], "methodology.supervised.data_split@1.0.0");
    assert_eq!(proposal["alternatives"].as_array().unwrap().len(), 4);

    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let request = json!({"alternative_id":"temporal","idempotency_key":"test-apply-temporal"});
    let (status, applied) = call(&api.app, "POST", &uri, Some(request.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    assert_eq!(
        applied["pipeline"]["parent_id"],
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"
    );
    assert_eq!(
        applied["pipeline"]["nodes"][1]["operator"],
        "sprisk.validation.temporal_split@1.0.0"
    );
    assert_eq!(
        applied["pipeline"]["nodes"][1]["methodology_decision_id"],
        applied["decision"]["id"]
    );

    let (status, repeated) = call(&api.app, "POST", &uri, Some(request)).await;
    assert_eq!(status, StatusCode::OK, "{repeated}");
    assert_eq!(repeated, applied);

    let decision = format!(
        "/methodology_decisions/{}",
        applied["decision"]["id"].as_str().unwrap()
    );
    let (status, found) = call(&api.app, "GET", &decision, None).await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(found, applied["decision"]);

    let proposed = format!(
        "/methodology_proposals/{}",
        proposal["id"].as_str().unwrap()
    );
    let (status, found) = call(&api.app, "GET", &proposed, None).await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(found, proposal);
}

#[tokio::test]
async fn an_unknown_methodology_proposal_is_not_found() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "GET",
        "/methodology_proposals/mpr_01JABCDEFGHJKMNPQRSTVWXYZ9",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn an_unknown_methodology_decision_is_not_found() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "GET",
        "/methodology_decisions/mdc_01JABCDEFGHJKMNPQRSTVWXYZ9",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn clustering_methodology_is_resolved_previewed_and_applied_once() {
    let api = api().await;
    let question = json!({
        "schema_version": "sprisk.question_version/v1",
        "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ8",
        "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "objective": { "value": "Customer clustering exploration", "origin": "explicit" },
        "task": { "value": "exploration", "origin": "confirmed" },
        "assumptions": [],
        "unknowns": [],
        "acceptance_criteria": [],
        "created_at": "2026-10-15T10:00:00Z"
    });
    let (status, _) = call(&api.app, "POST", "/question_versions", Some(question)).await;
    assert_eq!(status, StatusCode::CREATED);

    let mut flow = pipeline(&api.csv);
    flow["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ8");
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ8");
    flow["nodes"].as_array_mut().unwrap().push(json!({
        "id": "cluster",
        "operator": "sprisk.clustering.kmeans@1.0.0",
        "params": { "n_clusters": 3 }
    }));
    flow["edges"] = json!([{ "from": "load.data", "to": "cluster.data" }]);
    let (status, _) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, proposal) = call(
        &api.app,
        "POST",
        "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ8/methodology/proposals/cluster",
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(
        proposal["recommended_alternative_id"],
        "kmeans_centroid_clustering"
    );
    assert_eq!(
        proposal["rule"],
        "methodology.unsupervised.clustering_algorithm@1.0.0"
    );
    assert_eq!(proposal["alternatives"].as_array().unwrap().len(), 4);

    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let request = json!({ "alternative_id": "dbscan_density_clustering", "idempotency_key": "test-apply-dbscan" });
    let (status, applied) = call(&api.app, "POST", &uri, Some(request.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    assert_eq!(
        applied["pipeline"]["parent_id"],
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ8"
    );
    assert_eq!(
        applied["pipeline"]["nodes"][1]["operator"],
        "sprisk.clustering.dbscan@1.0.0"
    );
    assert_eq!(
        applied["pipeline"]["nodes"][1]["methodology_decision_id"],
        applied["decision"]["id"]
    );
}

/// load -> split -> scale on a table whose `age` has one far outlier.
async fn scaling_flow(api: &Api) {
    scaling_flow_into(api, &[], &[]).await;
}

/// The scaling flow with `nodes` and `edges` added after the scale step.
async fn scaling_flow_into(api: &Api, extra_nodes: &[Value], extra_edges: &[Value]) {
    let mut csv = String::from("age,returned_within_30d\n");
    for i in 0..39 {
        csv.push_str(&format!("{},{}\n", 20 + i % 20, i % 2));
    }
    csv.push_str("1000,1\n");
    std::fs::write(&api.csv, csv).unwrap();
    // These rows have no time or entity column, so the question declares none and a random
    // split passes Gate B's split check.
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    let facts = q.as_object_mut().unwrap();
    facts.remove("time_column");
    facts.remove("entity_column");
    assert_eq!(
        call(&api.app, "POST", "/question_versions", Some(q))
            .await
            .0,
        StatusCode::CREATED
    );
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    let nodes = flow["nodes"].as_array_mut().unwrap();
    nodes.push(json!({
        "id":"split", "operator":"sprisk.validation.random_split@1.0.0",
        "params":{"test_fraction":0.25,"seed":42,"stratify":"returned_within_30d"}
    }));
    nodes.push(json!({
        "id":"scale", "operator":"sprisk.clean.scale@1.0.0",
        "params":{"columns":["age"],"method":"z_score"}
    }));
    nodes.extend(extra_nodes.iter().cloned());
    flow["edges"] = json!([
        {"from":"load.data","to":"split.data"},
        {"from":"split.train","to":"scale.train"},
        {"from":"split.test","to":"scale.test"}
    ]);
    flow["edges"]
        .as_array_mut()
        .unwrap()
        .extend(extra_edges.iter().cloned());
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

async fn propose_scaling(api: &Api) -> (StatusCode, Value) {
    call(
        &api.app,
        "POST",
        "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ0/methodology/proposals/scale",
        Some(json!({})),
    )
    .await
}

#[tokio::test]
async fn a_data_rule_asks_for_a_run_before_it_can_measure_the_train_rows() {
    let api = api().await;
    scaling_flow(&api).await;

    let (status, body) = propose_scaling(&api).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["errors"][0]["code"],
        "methodology_evidence_unavailable"
    );
}

#[tokio::test]
async fn scaling_is_decided_from_the_profile_of_the_steps_train_rows() {
    let api = api().await;
    scaling_flow(&api).await;
    let (run, _) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let (status, proposal) = propose_scaling(&api).await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(
        proposal["rule"],
        "methodology.supervised.feature_scaling@1.0.0"
    );
    assert_eq!(proposal["recommended_alternative_id"], "robust_scaling");
    let robust = proposal["alternatives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == "robust_scaling")
        .unwrap();
    assert_eq!(robust["effect"]["params"]["method"], "robust");
    assert!(
        proposal["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["label"] == "age outlier share" && e["origin"] == "measured"),
        "{proposal}"
    );
}

#[tokio::test]
async fn a_scale_step_feeding_a_random_forest_is_told_trees_need_no_scaling() {
    let api = api().await;
    let forest = json!({
        "id":"rf", "operator":"sprisk.ml.random_forest@1.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification","seed":0}
    });
    scaling_flow_into(
        &api,
        &[forest],
        &[json!({"from":"scale.train","to":"rf.train"})],
    )
    .await;
    let (run, _) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let (status, proposal) = propose_scaling(&api).await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(proposal["recommended_alternative_id"], "no_scaling");
    assert!(
        proposal["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "flow_fact" && e["value"] == "tree_ensemble"),
        "{proposal}"
    );
}

#[tokio::test]
async fn a_zero_fill_between_the_scale_step_and_the_model_keeps_scaling_in_play() {
    let api = api().await;
    // Zero means another value once scaled, so the model's own standardising cannot undo it.
    let nodes = [
        json!({"id":"fill", "operator":"sprisk.clean.impute@1.0.0",
               "params":{"columns":["age"],"method":"zero"}}),
        json!({"id":"lin", "operator":"sprisk.ml.linear_model@1.0.0",
               "params":{"target":"returned_within_30d","features":["age"],"task":"classification"}}),
    ];
    let edges = [
        json!({"from":"scale.train","to":"fill.train"}),
        json!({"from":"scale.test","to":"fill.test"}),
        json!({"from":"fill.train","to":"lin.train"}),
    ];
    scaling_flow_into(&api, &nodes, &edges).await;
    let (run, _) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let (status, proposal) = propose_scaling(&api).await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(proposal["recommended_alternative_id"], "robust_scaling");
    assert!(
        proposal["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["label"] == "Model family downstream" && e["value"] == "unknown"),
        "{proposal}"
    );
}

#[tokio::test]
async fn methodology_rules_are_listed_from_the_rule_packs() {
    let api = api().await;
    let (status, rules) = call(&api.app, "GET", "/methodology_rules", None).await;
    assert_eq!(status, StatusCode::OK);
    let rules = rules.as_array().unwrap();
    assert_eq!(rules.len(), 30);
    assert!(
        rules
            .iter()
            .any(|r| r["id"] == "methodology.supervised.data_split@1.0.0" && r["stage"] == "split")
    );
}

#[tokio::test]
async fn a_methodology_rule_source_is_its_files() {
    let api = api().await;
    let (status, source) = call(
        &api.app,
        "GET",
        "/methodology_rules/methodology.supervised.data_split@1.0.0/source",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{source}");
    assert_eq!(source["files"][0]["path"], "rule.yaml");
    assert_eq!(source["files"][0]["language"], "yaml");

    let (status, _) = call(
        &api.app,
        "GET",
        "/methodology_rules/methodology.pack.none@1.0.0/source",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_data_rule_refuses_train_rows_that_did_not_come_from_a_split() {
    let api = api().await;
    let q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    call(&api.app, "POST", "/question_versions", Some(q)).await;
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    flow["nodes"].as_array_mut().unwrap().push(json!({
        "id":"scale", "operator":"sprisk.clean.scale@1.0.0",
        "params":{"columns":["x"],"method":"z_score"}
    }));
    flow["edges"] = json!([
        {"from":"load.data","to":"scale.train"},
        {"from":"load.data","to":"scale.test"}
    ]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (status, body) = propose_scaling(&api).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["errors"][0]["code"],
        "methodology_evidence_unavailable"
    );
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("split"),
        "{body}"
    );
}
