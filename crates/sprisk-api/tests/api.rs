#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sprisk_api::{
    AppState, KernelLimits, Kernels, KeyMatcher, Profiler, Shifter, Splitter, resume_walks, router,
};
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
    state: AppState,
}

const KERNEL_LIMITS: KernelLimits = KernelLimits {
    cell_seconds: 20,
    memory_mb: 2048,
    idle: Duration::from_secs(600),
    at_once: 2,
};

/// The test profiler's code digest: stored profiles are kept under it.
const PROFILER_CODE: &str = "sha256:test-profiler";

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
    api_with_clock(
        python,
        splitter,
        limits,
        host,
        sprisk_scheduler::system_clock(),
    )
    .await
}

async fn api_with_clock(
    python: PathBuf,
    splitter: Splitter,
    limits: KernelLimits,
    host: Vec<String>,
    clock: sprisk_scheduler::Clock,
) -> Api {
    let dir = tempfile::tempdir().unwrap();
    let kernels = Kernels::new(host, dir.path().to_owned(), limits);
    let csv = dir.path().join("d.csv");
    std::fs::write(&csv, "x,y\n1,2\n3,4\n").unwrap();
    let root = root();
    let methodology = Registry::load_dir(&root.join("methodology")).unwrap();
    let gate = methodology
        .get("sprisk.methodology.supervised@1.0.0")
        .unwrap()
        .clone();
    let split_check = methodology
        .get("sprisk.methodology.split_rows@1.0.0")
        .unwrap()
        .clone();
    let plugins = Registry::load_dir(&root.join("plugins")).unwrap();
    let store = Arc::new(SqliteStore::in_memory().await.unwrap());
    let state = AppState {
        clock,
        store: store.clone(),
        artifacts: Arc::new(ArtifactStore::local(&dir.path().join("store")).unwrap()),
        rules: Arc::new(
            sprisk_methodology::RuleCatalog::load_dir(
                &root.join("methodology"),
                plugins.operators(),
            )
            .unwrap(),
        ),
        registry: Arc::new(plugins),
        gate: Some(gate),
        split_check: Some(split_check),
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
        code_writer: sprisk_api::CodeWriter::new(
            vec![
                python.display().to_string(),
                "-m".into(),
                "sprisk_workers.notebook_code".into(),
            ],
            Duration::from_secs(30),
            2,
        ),
        rule_runner: sprisk_api::RuleRunner::new(
            vec![
                python.display().to_string(),
                "-m".into(),
                "sprisk_workers.rule".into(),
            ],
            Duration::from_secs(30),
            2,
        ),
        method_runner: sprisk_api::MethodRunner::new(
            vec![
                python.display().to_string(),
                "-m".into(),
                "sprisk_workers.method".into(),
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
            PROFILER_CODE.into(),
        ),
        key_matcher: KeyMatcher::new(
            vec![
                python.display().to_string(),
                "-m".into(),
                "sprisk_profile.keys".into(),
            ],
            Duration::from_secs(30),
            2,
        ),
        shifter: Shifter::new(
            vec![
                python.display().to_string(),
                "-m".into(),
                "sprisk_profile.shift".into(),
            ],
            Duration::from_secs(30),
            2,
        ),
        kernels: kernels.clone(),
    };
    Api {
        _dir: dir,
        app: router(state.clone()),
        csv,
        kernels,
        store,
        state,
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

/// A ready-made step written as plain Python for a notebook cell (ADR-0055).
#[tokio::test(flavor = "multi_thread")]
async fn a_step_is_written_as_plain_python_with_its_settings_and_names() {
    let api = api().await;
    let request = json!({
        "settings": {"test_fraction": 0.25, "seed": 42, "stratify": "credit_risk"},
        "inputs": {"data": "load_data"},
        "outputs": {"train": "split_train", "test": "split_test"}
    });
    let uri = "/operators/sprisk.validation.random_split@1.0.0/notebook_code";
    let (status, body) = call(&api.app, "POST", uri, Some(request.clone())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let code = body["code"].as_str().unwrap();
    assert!(code.contains("train_test_split("), "{code}");
    assert!(code.contains("stratify=load_data['credit_risk']"), "{code}");

    // Settings the step does not allow are refused, naming the rule they break.
    let mut bad = request.clone();
    bad["settings"]["test_fraction"] = json!(2.0);
    let (status, body) = call(&api.app, "POST", uri, Some(bad)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_settings", "{body}");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("2.0"),
        "{body}"
    );

    // A step with no plain code yet, and a step that does not exist.
    let uri = "/operators/sprisk.ml.select_model@5.0.0/notebook_code";
    let (status, body) = call(&api.app, "POST", uri, Some(request.clone())).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(body["errors"][0]["code"], "no_plain_code", "{body}");
    let uri = "/operators/acme.io.csv@0.1.0/notebook_code";
    let (status, body) = call(&api.app, "POST", uri, Some(request)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

/// A model's optional words (ADR-0058) may be left out of its cell, or named; its cell reads
/// back as its settings either way. A port the model does not have is refused.
#[tokio::test(flavor = "multi_thread")]
async fn a_model_cell_is_written_and_read_with_or_without_its_words() {
    let api = api().await;
    let model = "/operators/sprisk.ml.linear_model@3.0.0";
    let settings = json!({"target": "y", "task": "classification"});
    let outputs = json!({"model": "model"});
    for inputs in [
        json!({"train": "rows"}),
        json!({"train": "rows", "words": "rows_words"}),
    ] {
        let write = json!({"settings": settings, "inputs": inputs, "outputs": outputs});
        let (status, body) = call(
            &api.app,
            "POST",
            &format!("{model}/notebook_code"),
            Some(write),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let code = body["code"].clone();
        assert_eq!(
            code.as_str().unwrap().contains("rows_words,"),
            inputs.get("words").is_some(),
            "{code}"
        );
        let read =
            json!({"settings": settings, "inputs": inputs, "outputs": outputs, "code": code});
        let (status, body) = call(
            &api.app,
            "POST",
            &format!("{model}/notebook_settings"),
            Some(read),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["reads_as"], "settings", "{body}");
    }

    // A port the model does not have, or words without the train rows it needs.
    for inputs in [
        json!({"train": "rows", "pictures": "p"}),
        json!({"words": "rows_words"}),
    ] {
        let read = json!({
            "settings": settings,
            "inputs": inputs,
            "outputs": outputs,
            "code": "model = 1\n"
        });
        let uri = format!("{model}/notebook_settings");
        let (_, body) = call(&api.app, "POST", &uri, Some(read)).await;
        assert_eq!(
            body["errors"][0]["code"], "invalid_ports",
            "{inputs}: {body}"
        );
    }
}

/// An edited ready-made cell (ADR-0055): only values changed reads back as the step's
/// settings, so it keeps its checks; anything more reads as code.
#[tokio::test(flavor = "multi_thread")]
async fn an_edited_cell_reads_back_as_settings_when_only_values_changed() {
    let api = api().await;
    // n_estimators is unset, so the cell shows its default, 200.
    let names = json!({ "inputs": {"train": "train"}, "outputs": {"model": "model"} });
    let settings = json!({"target": "y", "task": "classification"});
    let mut request = names.clone();
    request["settings"] = settings.clone();
    let forest = "/operators/sprisk.ml.random_forest@3.0.0";
    let (_, written) = call(
        &api.app,
        "POST",
        &format!("{forest}/notebook_code"),
        Some(request.clone()),
    )
    .await;
    let code = written["code"].as_str().unwrap().to_owned();
    let read = |code: String| {
        let mut edited = request.clone();
        edited["code"] = json!(code);
        let app = api.app.clone();
        async move {
            call(
                &app,
                "POST",
                &format!("{forest}/notebook_settings"),
                Some(edited),
            )
            .await
        }
    };

    let (status, body) = read(code.replace("n_estimators=200", "n_estimators=500")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!({"reads_as": "settings", "settings": {"target": "y", "task": "classification", "n_estimators": 500}})
    );
    // A default left as it was is not written into the settings.
    let (_, body) = read(code.clone()).await;
    assert_eq!(body, json!({"reads_as": "settings", "settings": settings}));
    let (_, body) = read(format!("{code}print(model)\n")).await;
    assert_eq!(body, json!({"reads_as": "code"}));
    // A value the step's settings do not allow is refused, naming the rule it breaks.
    let (status, body) = read(code.replace("n_estimators=200", "n_estimators=3")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_settings", "{body}");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("10"),
        "{body}"
    );
}

/// An edited cell is read only for a request the step allows: its settings and its ports
/// are checked before any code is read.
#[tokio::test(flavor = "multi_thread")]
async fn an_edited_cell_is_read_only_for_settings_and_ports_the_step_allows() {
    let api = api().await;
    let uri = "/operators/sprisk.ml.random_forest@3.0.0/notebook_settings";
    let request = json!({
        "settings": {"target": "y", "task": "classification"},
        "inputs": {"train": "train"}, "outputs": {"model": "model"},
        "code": "print('anything')\n",
    });
    let (status, body) = call(&api.app, "POST", uri, Some(request.clone())).await;
    assert_eq!(body, json!({"reads_as": "code"}), "{status}");

    let mut bad = request.clone();
    bad["settings"]["n_estimators"] = json!(3);
    let (status, body) = call(&api.app, "POST", uri, Some(bad)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_settings", "{body}");

    for (side, ports) in [("inputs", json!({"rows": "train"})), ("outputs", json!({}))] {
        let mut bad = request.clone();
        bad[side] = ports;
        let (status, body) = call(&api.app, "POST", uri, Some(bad)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{side}: {body}");
        assert_eq!(body["errors"][0]["code"], "invalid_ports", "{side}: {body}");
    }
}

/// A split's cell may change its values, never become code: the leakage checks find the test
/// rows by the split step (ADR-0055).
#[tokio::test(flavor = "multi_thread")]
async fn a_split_cell_may_change_values_but_never_become_code() {
    let api = api().await;
    let mut request = json!({
        "settings": {"test_fraction": 0.25, "seed": 42},
        "inputs": {"data": "df"}, "outputs": {"train": "train", "test": "test"},
    });
    let split = "/operators/sprisk.validation.random_split@1.0.0";
    let (_, written) = call(
        &api.app,
        "POST",
        &format!("{split}/notebook_code"),
        Some(request.clone()),
    )
    .await;
    let code = written["code"].as_str().unwrap().to_owned();
    let uri = format!("{split}/notebook_settings");

    request["code"] = json!(code.replace("seed=42", "seed=7"));
    let (status, body) = call(&api.app, "POST", &uri, Some(request.clone())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["settings"]["seed"], 7, "{body}");

    request["code"] = json!(format!("{code}test = train\n"));
    let (status, body) = call(&api.app, "POST", &uri, Some(request)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "split_is_not_code", "{body}");
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

#[tokio::test(flavor = "multi_thread")]
async fn a_run_from_a_step_runs_it_again_and_says_so_and_an_unknown_step_is_refused() {
    let api = api().await;
    let (_, version) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    let id = version["id"].clone();
    let (_, first) = call(
        &api.app,
        "POST",
        "/runs",
        Some(json!({"pipeline_version_id": id})),
    )
    .await;
    wait_run(&api, first["id"].as_str().unwrap()).await;

    let unknown = json!({"pipeline_version_id": id, "reuse_run_id": first["id"], "run_from_node_id": "nowhere"});
    let (status, body) = call(&api.app, "POST", "/runs", Some(unknown)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "unknown_step", "{body}");

    let from =
        json!({"pipeline_version_id": id, "reuse_run_id": first["id"], "run_from_node_id": "load"});
    let (status, second) = call(&api.app, "POST", "/runs", Some(from)).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{second}");
    assert_eq!(second["run_from_node_id"], "load");
    let (_, attempts) = wait_run(&api, second["id"].as_str().unwrap()).await;
    let load = attempts
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["node_id"] == "load")
        .unwrap();
    // Reusing alone would take load from the first run; run from load reads the file again.
    assert_eq!(load["state"], "succeeded", "{attempts}");
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

/// The Explore page asks how the columns relate to a label; the profile without one has none.
#[tokio::test]
async fn a_profile_asked_with_a_label_relates_the_columns_to_it() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    run_to_end(&api).await;
    let (_, datasets) = call(&api.app, "GET", "/loaded_tables", None).await;
    let path = format!(
        "/artifacts/{}/profile",
        datasets[0]["artifact"]["id"].as_str().unwrap()
    );

    let (status, plain) = call(&api.app, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK, "{plain}");
    assert!(plain.get("label").is_none(), "{plain}");
    let (status, labelled) = call(&api.app, "GET", &format!("{path}?target=y"), None).await;
    assert_eq!(status, StatusCode::OK, "{labelled}");
    assert_eq!(labelled["label"]["target"], "y", "{labelled}");
}

/// Dataset Explore is an API-owned deterministic plan: the same Rakuten-shaped input and
/// question ledger always select the same ordered views and state why each is present.
#[tokio::test]
async fn a_profile_plan_follows_the_question_ledger_and_profile_facts() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    run_to_end(&api).await;
    let (_, datasets) = call(&api.app, "GET", "/loaded_tables", None).await;
    let artifact = datasets[0]["artifact"]["id"].as_str().unwrap();

    let path = format!(
        "/artifacts/{artifact}/profile_plan?question_version_id=qv_01JABCDEFGHJKMNPQRSTVWXYZ0"
    );
    let (status, first) = call(&api.app, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["scope"], "input");
    assert_eq!(
        first["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|section| section["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "overview",
            "data_quality",
            "columns",
            "relationships",
            "target",
            "classification",
            "text",
            "categories",
        ],
        "{first}"
    );
    assert_eq!(
        first["sections"][5]["reason"],
        "The question ledger declares a classification task with a target."
    );

    let (status, second) = call(&api.app, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(first, second, "the selector must be deterministic");

    let (status, neutral) = call(
        &api.app,
        "GET",
        &format!("/artifacts/{artifact}/profile_plan"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{neutral}");
    assert!(neutral.get("question_version_id").is_none(), "{neutral}");
    assert!(
        neutral["sections"]
            .as_array()
            .unwrap()
            .iter()
            .all(|section| section["id"] != "classification"),
        "{neutral}"
    );
}

/// The Explore page compares a split's train rows with its test rows (ADR-0065).
#[tokio::test]
async fn a_table_is_compared_with_another_column_by_column() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    run_to_end(&api).await;
    let (_, datasets) = call(&api.app, "GET", "/loaded_tables", None).await;
    let id = datasets[0]["artifact"]["id"].as_str().unwrap();

    let (status, shift) = call(
        &api.app,
        "GET",
        &format!("/artifacts/{id}/shift?against={id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{shift}");
    assert_eq!(shift["rows"], shift["other_rows"], "{shift}");
    assert_eq!(shift["columns"][0]["ks"], 0.0, "{shift}");

    let (status, body) = call(&api.app, "GET", &format!("/artifacts/{id}/shift"), None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "missing_against", "{body}");
}

/// A table never changes, so its profile is made once and then read from the store (ADR-0065).
#[tokio::test]
async fn a_table_is_profiled_once_and_its_profile_kept() {
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
    let (_, datasets) = call(&api.app, "GET", "/loaded_tables", None).await;
    let artifact = &datasets[0]["artifact"];
    let content = artifact["content_hash"].as_str().unwrap();
    let path = format!("/artifacts/{}/profile", artifact["id"].as_str().unwrap());

    let (status, made) = call(&api.app, "GET", &path, None).await;
    assert_eq!(status, StatusCode::OK, "{made}");
    let kept = api
        .store
        .stored_profile(content, PROFILER_CODE, None)
        .await
        .unwrap();
    assert_eq!(serde_json::to_value(kept.unwrap()).unwrap(), made);

    // A stored profile is served as it is: the profiler does not run again.
    let mut marked = api
        .store
        .stored_profile(content, PROFILER_CODE, None)
        .await
        .unwrap()
        .unwrap();
    marked.total_rows = 999;
    let other = format!("sha256:{}", "b".repeat(64));
    api.store
        .save_profile(&other, PROFILER_CODE, None, &marked)
        .await
        .unwrap();
    let mut copy: sprisk_contracts::Artifact = serde_json::from_value(artifact.clone()).unwrap();
    copy.id = "art_01JABCDEFGHJKMNPQRSTVWXY99".parse().unwrap();
    copy.content_hash = other.parse().unwrap();
    api.store.insert_artifact(&copy).await.unwrap();
    let (status, served) = call(
        &api.app,
        "GET",
        "/artifacts/art_01JABCDEFGHJKMNPQRSTVWXY99/profile",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{served}");
    assert_eq!(served["total_rows"], 999);
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
async fn a_question_s_costs_must_be_positive_and_belong_to_a_classification() {
    let api = api().await;
    let costed = |fn_cost: f64, fp_cost: f64| {
        let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
        q["costs"] = json!({
            "value": { "positive": "1", "false_negative": fn_cost, "false_positive": fp_cost },
            "origin": "explicit"
        });
        q
    };
    for (fn_cost, fp_cost) in [(0.0, 1.0), (5.0, -1.0)] {
        let (status, body) = call(
            &api.app,
            "POST",
            "/question_versions",
            Some(costed(fn_cost, fp_cost)),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["errors"][0]["code"], "invalid_costs", "{body}");
    }
    let mut regression = costed(5.0, 1.0);
    regression["task"] = json!({ "value": "regression", "origin": "explicit" });
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(regression)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_costs", "{body}");

    let (status, body) = call(
        &api.app,
        "POST",
        "/question_versions",
        Some(costed(5.0, 1.0)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

/// A binding a person states: `column` of the loaded data means `concept`.
fn stated(concept: &str, column: &str) -> Value {
    json!({ "schema_version": "sprisk.binding/v1", "concept": concept,
            "source": { "column": column }, "set_by": { "assurance": "stated" } })
}

#[tokio::test]
async fn a_question_answers_only_methods_the_packs_load_with_their_options_and_each_once() {
    let api = api().await;
    let answered = |answers: Value| {
        let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
        q["answers"] = answers;
        q
    };
    let refused = |body: &Value, why: &str| {
        assert_eq!(body["errors"][0]["code"], "invalid_answers", "{body}");
        assert!(
            body["errors"][0]["message"].as_str().unwrap().contains(why),
            "{body}"
        );
    };
    for (answers, why) in [
        (
            json!([{ "decides": "data.repeated_rows", "option": "group_by_title" }]),
            "no method decides data.repeated_rows",
        ),
        (
            json!([{ "decides": "data.repeated_items", "option": "shuffled" }]),
            "data.repeated_items has no option shuffled",
        ),
        (
            json!([{ "decides": "data.repeated_items", "option": "group_by_title" },
                   { "decides": "data.repeated_items", "option": "independent_rows" }]),
            "data.repeated_items is answered twice",
        ),
    ] {
        let (status, body) = call(
            &api.app,
            "POST",
            "/question_versions",
            Some(answered(answers)),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        refused(&body, why);
    }
    let fine = answered(json!([{ "decides": "data.repeated_items", "option": "group_by_title" }]));
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(fine)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn a_question_binds_only_concepts_the_packs_define_and_each_once() {
    let api = api().await;
    let bound = |bindings: Value| {
        let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
        q["bindings"] = bindings;
        q
    };
    let unknown = bound(json!([stated("common.item_name", "designation")]));
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(unknown)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_bindings", "{body}");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("no pack defines the concept common.item_name"),
        "{body}"
    );

    let twice = bound(json!([
        stated("common.item_title", "designation"),
        stated("common.item_title", "description")
    ]));
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(twice)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("common.item_title is bound twice"),
        "{body}"
    );

    // A title is a column of the loaded data; a column a step makes is not offered for it.
    let mut derived = stated("common.item_title", "item_group");
    derived["source"]["step"] = json!("near_duplicates");
    let (status, body) = call(
        &api.app,
        "POST",
        "/question_versions",
        Some(bound(json!([derived]))),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["errors"][0]["message"].as_str().unwrap().contains(
            "common.item_title binds to a column of the loaded data, not one a step makes"
        ),
        "{body}"
    );

    let once = bound(json!([stated("common.item_title", "designation")]));
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(once)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["bindings"][0]["source"]["column"], "designation");
}

#[tokio::test]
async fn a_question_s_success_bar_must_be_a_score_its_task_can_reach() {
    let api = api().await;
    let barred = |metric: &str, score: f64| {
        let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
        q["success_bar"] =
            json!({ "value": { "metric": metric, "score": score }, "origin": "explicit" });
        q
    };
    for (metric, score) in [
        ("balanced_accuracy", 1.5),
        ("balanced_accuracy", -0.1),
        ("expected_cost", -1.0),
        ("rmse", 2.0),
        ("weighted_f1", 1.2),
    ] {
        let (status, body) = call(
            &api.app,
            "POST",
            "/question_versions",
            Some(barred(metric, score)),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{metric} {score}: {body}"
        );
        assert_eq!(body["errors"][0]["code"], "invalid_success_bar", "{body}");
    }
    let (status, body) = call(
        &api.app,
        "POST",
        "/question_versions",
        Some(barred("balanced_accuracy", 0.7)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // With costs, models are compared by expected cost, so a bar in another metric clashes.
    for metric in ["weighted_f1", "balanced_accuracy"] {
        let mut costed = barred(metric, 0.8);
        costed["id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ1");
        costed["costs"] = json!({ "value": { "positive": "1", "false_negative": 5.0, "false_positive": 1.0 },
                                   "origin": "explicit" });
        let (status, body) = call(&api.app, "POST", "/question_versions", Some(costed)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{metric}: {body}");
        assert!(
            body["errors"][0]["message"]
                .as_str()
                .unwrap()
                .contains("expected cost"),
            "{body}"
        );
    }
}

#[tokio::test]
async fn a_revision_keeps_the_metric_its_success_bar_was_stated_in() {
    let api = api().await;
    let barred = |id: &str, parent: Option<&str>, metric: &str| {
        let mut q = question(id, parent);
        q["success_bar"] =
            json!({ "value": { "metric": metric, "score": 0.7 }, "origin": "explicit" });
        q
    };
    let first = barred("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None, "balanced_accuracy");
    assert_eq!(
        call(&api.app, "POST", "/question_versions", Some(first))
            .await
            .0,
        StatusCode::CREATED
    );
    // Models may have been compared by it: a new metric would be chosen after the scores.
    let switched = barred(
        "qv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        Some("qv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
        "weighted_f1",
    );
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(switched)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["errors"][0]["code"], "success_bar_metric_changed",
        "{body}"
    );
    let raised = barred(
        "qv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        Some("qv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
        "balanced_accuracy",
    );
    assert_eq!(
        call(&api.app, "POST", "/question_versions", Some(raised))
            .await
            .0,
        StatusCode::CREATED
    );
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
async fn a_step_s_proposal_can_be_asked_for_one_decision() {
    let api = api().await;
    cluster_proposal(&api).await;
    let uri = "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ8/methodology/proposals/cluster";

    let (status, proposal) = call(
        &api.app,
        "POST",
        &format!("{uri}/clustering.algorithm_choice"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(
        proposal["rule"],
        "methodology.unsupervised.clustering_algorithm@1.0.0"
    );

    let (status, body) = call(
        &api.app,
        "POST",
        &format!("{uri}/evaluation.decision_threshold"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "methodology_not_applicable");
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
    let proposal = cluster_proposal(&api).await;
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
    // DBSCAN is not the recommendation, so choosing it needs a reason.
    let bare = json!({ "alternative_id": "dbscan_density_clustering", "idempotency_key": "test-apply-dbscan-bare" });
    let (status, body) = call(&api.app, "POST", &uri, Some(bare)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "reason_required");
    let request = json!({ "alternative_id": "dbscan_density_clustering", "idempotency_key": "test-apply-dbscan",
                          "reason": "The clusters are not convex." });
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

/// The scaling flow with `nodes` and `edges` added after the scale step.
async fn scaling_flow_into(api: &Api, extra_nodes: &[Value], extra_edges: &[Value]) {
    scaling_flow_barred(api, extra_nodes, extra_edges, "balanced_accuracy").await;
}

/// The scaling flow, its question's success bar stated in `metric`.
async fn scaling_flow_barred(
    api: &Api,
    extra_nodes: &[Value],
    extra_edges: &[Value],
    metric: &str,
) {
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
    facts.insert(
        "success_bar".into(),
        json!({ "value": { "metric": metric, "score": 0.7 }, "origin": "explicit" }),
    );
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

#[tokio::test]
async fn a_data_rule_asks_for_a_run_before_it_can_measure_the_train_rows() {
    let api = api().await;
    let model = json!({
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification"}
    });
    scaling_flow_into(
        &api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
    )
    .await;

    let (status, body) = propose_model(&api).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["errors"][0]["code"],
        "methodology_evidence_unavailable"
    );
}

/// The scaling flow with a linear model after the scale step, run to the end.
async fn model_flow(api: &Api) {
    let model = json!({
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification"}
    });
    scaling_flow_into(
        api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
    )
    .await;
    let (run, _) = run_to_end(api).await;
    assert_eq!(run["status"], "succeeded", "{run}");
}

/// The model shortlist of step `model`: a model step has several rules, so it is named.
async fn propose_model(api: &Api) -> (StatusCode, Value) {
    call(
        &api.app,
        "POST",
        "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ0/methodology/proposals/model/modeling.estimator_selection",
        Some(json!({})),
    )
    .await
}

#[tokio::test]
async fn a_model_step_gets_a_shortlist_from_the_registered_models() {
    let api = api().await;
    model_flow(&api).await;

    let (status, proposal) = propose_model(&api).await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(
        proposal["rule"],
        "methodology.supervised.model_baseline_selection@2.1.0"
    );
    // 30 train rows: too few for a forest, so the baseline and the linear model.
    assert_eq!(
        proposal["shortlist"],
        json!(["ml_dummy_baseline", "ml_linear_model"])
    );
    assert!(proposal.get("recommended_alternative_id").is_none());
    let forest = proposal["alternatives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == "ml_random_forest")
        .unwrap();
    assert_eq!(
        forest["effect"]["operator"],
        "sprisk.ml.random_forest@3.0.0"
    );
    assert_eq!(forest["effect"]["params"]["features"], json!(["age"]));
}

#[tokio::test]
async fn a_model_with_no_features_is_measured_on_every_column_but_its_target() {
    let api = api().await;
    let model = json!({
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"returned_within_30d","task":"classification"}
    });
    scaling_flow_into(
        &api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
    )
    .await;
    let (run, _) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let (status, proposal) = propose_model(&api).await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    let features = proposal["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["label"] == "Feature columns")
        .unwrap();
    assert_eq!(features["value"], "1", "age alone: {proposal}");
}

#[tokio::test]
async fn choosing_a_shortlisted_model_without_comparing_needs_a_reason() {
    let api = api().await;
    model_flow(&api).await;
    let (_, proposal) = propose_model(&api).await;
    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );

    let bare =
        json!({ "alternative_id": "ml_random_forest", "idempotency_key": "test-apply-forest" });
    let (status, body) = call(&api.app, "POST", &uri, Some(bare)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "reason_required");

    let reasoned = json!({ "alternative_id": "ml_random_forest", "idempotency_key": "test-apply-forest-2",
                           "reason": "The team needs feature interactions." });
    let (status, applied) = call(&api.app, "POST", &uri, Some(reasoned)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    let model = applied["pipeline"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "model")
        .unwrap();
    assert_eq!(model["operator"], "sprisk.ml.random_forest@3.0.0");
}

#[tokio::test]
async fn concepts_are_listed_from_the_packs_for_a_person_to_bind() {
    let api = api().await;
    let (status, set) = call(&api.app, "GET", "/concepts", None).await;
    assert_eq!(status, StatusCode::OK, "{set}");
    assert_eq!(set["schema_version"], "sprisk.concept_set/v1");
    assert_eq!(
        set["concepts"]["common.item_title"]["kind"], "text",
        "{set}"
    );
}

#[tokio::test]
async fn methodology_rules_are_listed_from_the_rule_packs() {
    let api = api().await;
    let (status, rules) = call(&api.app, "GET", "/methodology_rules", None).await;
    assert_eq!(status, StatusCode::OK);
    let rules = rules.as_array().unwrap();
    assert_eq!(rules.len(), 63);

    // Methods are bridged into rules with their options as alternatives.
    let split = rules
        .iter()
        .find(|r| r["id"] == "methodology.supervised.split_method@1.0.0")
        .unwrap();
    assert_eq!(split["stage"], "split");
    assert_eq!(split["decides"], "split.method");
    assert_eq!(split["status"], "active");
    assert!(split["alternatives"].as_array().unwrap().len() >= 2);
    // The words people read go with each rule (ADR-0045 amendment).
    let clustering = rules
        .iter()
        .find(|r| r["id"] == "methodology.unsupervised.clustering_algorithm@1.0.0")
        .unwrap();
    assert_eq!(clustering["stage"], "models");
    assert_eq!(
        clustering["question"],
        "Which clustering algorithm should group the rows?"
    );
    assert_eq!(
        clustering["alternatives"][0]["when"],
        "always, as the baseline while cluster shape is not recorded"
    );
}

#[tokio::test]
async fn a_methodology_rule_source_is_its_files() {
    let api = api().await;
    let (status, source) = call(
        &api.app,
        "GET",
        "/methodology_rules/methodology.unsupervised.clustering_algorithm@1.0.0/source",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{source}");
    assert_eq!(source["files"][0]["path"], "rule.yaml");
    assert_eq!(source["files"][0]["language"], "yaml");

    // Bridged method files are served through the same source endpoint.
    let (status, source) = call(
        &api.app,
        "GET",
        "/methodology_rules/methodology.supervised.split_method@1.0.0/source",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{source}");
    assert_eq!(source["files"][0]["path"], "method.yaml");
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
async fn a_method_s_files_are_its_manifest_and_module() {
    let api = api().await;
    let uri = "/methods/methodology.supervised.split_method@1.0.0/files";
    let (status, files) = call(&api.app, "GET", uri, None).await;
    assert_eq!(status, StatusCode::OK, "{files}");
    assert_eq!(files["files"][0]["path"], "method.yaml");
    assert_eq!(files["files"][1]["path"], "method.py");
    assert!(
        files["files"][1]["text"]
            .as_str()
            .unwrap()
            .contains("def verify_no_group_overlap")
    );

    let (status, _) = call(
        &api.app,
        "GET",
        "/methods/methodology.pack.none@1.0.0/files",
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
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"y","features":["x"],"task":"classification"}
    }));
    flow["edges"] = json!([{"from":"load.data","to":"model.train"}]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (status, body) = propose_model(&api).await;
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

#[tokio::test]
async fn a_group_split_s_rows_are_checked_after_it_runs() {
    let api = api().await;
    let mut csv = String::from("patient,x,y\n");
    for i in 0..20 {
        csv.push_str(&format!("p{},{i},{}\n", i % 5, i % 2));
    }
    std::fs::write(&api.csv, csv).unwrap();
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    let facts = q.as_object_mut().unwrap();
    facts.remove("time_column");
    facts.insert(
        "entity_column".into(),
        json!({"value": "patient", "origin": "confirmed"}),
    );
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    flow["nodes"].as_array_mut().unwrap().push(json!({
        "id":"split", "operator":"sprisk.validation.group_split@1.0.0",
        "params":{"group_column":"patient","test_fraction":0.4,"seed":1}
    }));
    flow["edges"] = json!([{"from":"load.data","to":"split.data"}]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (run, attempts) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");
    let check = attempts
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["node_id"] == "gate_split")
        .unwrap_or_else(|| panic!("no split check: {attempts}"));
    assert_eq!(check["state"], "succeeded", "{check}");
    let uri = format!("/attempts/{}/outputs", check["id"].as_str().unwrap());
    let (_, outputs) = call(&api.app, "GET", &uri, None).await;
    let artifact = outputs[0]["artifact"]["id"].as_str().unwrap();
    let content = format!("/artifacts/{artifact}/content");
    let (_, checks) = call(&api.app, "GET", &content, None).await;
    assert_eq!(checks[0]["phase"], "runtime", "{checks}");
    assert_eq!(checks[0]["verdict"], "pass", "{checks}");
    assert_eq!(checks[0]["cited_nodes"], json!(["split"]));
}

async fn compare(api: &Api, proposal: &Value) -> (StatusCode, Value) {
    let uri = format!(
        "/methodology_proposals/{}/compare",
        proposal["id"].as_str().unwrap()
    );
    call(&api.app, "POST", &uri, Some(json!({}))).await
}

/// Runs `version` and waits, bounded, for it to end; gives the run and its attempts.
async fn run_version(api: &Api, version: &str) -> (Value, Value) {
    let create = json!({ "pipeline_version_id": version });
    let (status, run) = call(&api.app, "POST", "/runs", Some(create)).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    wait_run(api, run["id"].as_str().unwrap()).await
}

/// Waits, bounded, for run `id` to end; gives the run and its attempts.
async fn wait_run(api: &Api, id: &str) -> (Value, Value) {
    let run_uri = format!("/runs/{id}");
    for _ in 0..1200 {
        let (_, body) = call(&api.app, "GET", &run_uri, None).await;
        if body["status"] == "succeeded" || body["status"] == "failed" {
            let (_, attempts) = call(&api.app, "GET", &format!("{run_uri}/attempts"), None).await;
            return (body, attempts);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("run {run_uri} did not end");
}

/// The artifact a step's attempt wrote on `port`.
async fn output_artifact(api: &Api, attempts: &Value, node: &str, port: &str) -> String {
    let attempt = attempts
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["node_id"] == node)
        .unwrap_or_else(|| panic!("no attempt of {node}: {attempts}"));
    let uri = format!("/attempts/{}/outputs", attempt["id"].as_str().unwrap());
    let (_, outputs) = call(&api.app, "GET", &uri, None).await;
    outputs
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["port"] == port)
        .unwrap()["artifact"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// The JSON a step's attempt wrote on `port`.
async fn output(api: &Api, attempts: &Value, node: &str, port: &str) -> Value {
    let artifact = output_artifact(api, attempts, node, port).await;
    use tower::ServiceExt;
    let request = Request::builder()
        .uri(format!("/artifacts/{artifact}/content"))
        .header("host", "127.0.0.1:7420")
        .body(Body::empty())
        .unwrap();
    let response = api.app.clone().oneshot(request).await.unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn a_shortlist_is_cross_validated_on_train_rows_and_the_winner_applied() {
    let api = api().await;
    model_flow(&api).await;
    let (_, proposal) = propose_model(&api).await;

    let (status, comparison) = compare(&api, &proposal).await;
    assert_eq!(status, StatusCode::CREATED, "{comparison}");
    assert_eq!(comparison["compares"], proposal["id"]);
    assert!(comparison.get("parent_id").is_none(), "{comparison}");
    let steps: Vec<&str> = comparison["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        steps,
        [
            "load",
            "split",
            "cv_ml_dummy_baseline",
            "cv_ml_linear_model",
            "select_model"
        ]
    );
    let read_from_split: Vec<&str> = comparison["edges"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["from"].as_str()?.strip_prefix("split."))
        .collect();
    assert_eq!(read_from_split, ["train", "train"]);

    let (status, again) = compare(&api, &proposal).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["id"], comparison["id"]);

    let (run, attempts) = run_version(&api, comparison["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");
    let decision = output(&api, &attempts, "select_model", "decision").await;
    parse::<sprisk_contracts::SelectionDecision>(&decision.to_string()).unwrap();
    assert_eq!(decision["metric"], "balanced_accuracy");
    assert_eq!(decision["baseline"], "ml_dummy_baseline");
    // The scale step between the split and the model is refit in every fold, so nothing is
    // left out; only how "beats the baseline" was tested is a limitation.
    let limitations = decision["limitations"].as_array().unwrap();
    assert_eq!(limitations.len(), 1, "{limitations:?}");
    assert!(
        limitations[0]
            .as_str()
            .unwrap()
            .starts_with("Beating the baseline means a corrected")
    );
    let cv = comparison["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "cv_ml_linear_model")
        .unwrap();
    assert_eq!(
        cv["params"]["prepare"][0]["operator"],
        "sprisk.clean.scale@1.0.0"
    );

    // The comparison is a side version: the proposal still applies to the flow.
    let chosen = decision["winner"].as_str().unwrap_or("ml_linear_model");
    let apply = json!({
        "alternative_id": chosen, "idempotency_key": "test-apply-compared",
        "reason": format!("Cross-validation: {}", decision["reason"].as_str().unwrap())
    });
    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let (status, applied) = call(&api.app, "POST", &uri, Some(apply)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    let model = applied["pipeline"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "model")
        .unwrap();
    let operator = model["operator"].as_str().unwrap();
    assert!(
        operator.starts_with(&format!("sprisk.{}@", chosen.replacen('_', ".", 1))),
        "{operator}"
    );
}

#[tokio::test]
async fn a_comparison_is_built_only_by_compare_and_never_edited_by_a_rule() {
    let api = api().await;
    model_flow(&api).await;
    let (_, proposal) = propose_model(&api).await;
    let (_, comparison) = compare(&api, &proposal).await;

    let mut forged = pipeline(&api.csv);
    forged["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ5");
    forged["compares"] = proposal["id"].clone();
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(forged)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "comparison_by_compare");

    let uri = format!(
        "/pipeline_versions/{}/methodology/proposals/split",
        comparison["id"].as_str().unwrap()
    );
    let (status, body) = call(&api.app, "POST", &uri, Some(json!({}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "comparison_not_editable");
}

#[tokio::test]
async fn only_a_shortlist_proposal_can_be_compared() {
    let api = api().await;
    let proposal = cluster_proposal(&api).await;

    let (status, body) = compare(&api, &proposal).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "methodology_not_applicable");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("has no shortlist to compare"),
        "{body}"
    );
}

#[tokio::test]
async fn a_proposal_whose_flow_was_edited_cannot_be_compared_but_its_own_branch_is_no_edit() {
    let api = api().await;
    model_flow(&api).await;
    let (_, proposal) = propose_model(&api).await;
    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let apply = json!({ "alternative_id": "ml_dummy_baseline", "idempotency_key": "test-apply-first",
                        "reason": "A floor to start from." });
    assert_eq!(
        call(&api.app, "POST", &uri, Some(apply)).await.0,
        StatusCode::CREATED
    );
    let (status, body) = compare(&api, &proposal).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (_, base) = call(
        &api.app,
        "GET",
        "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        None,
    )
    .await;
    let mut edited = base.clone();
    edited["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ7");
    edited["parent_id"] = base["id"].clone();
    edited["nodes"][1]["params"]["seed"] = json!(7);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(edited)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    // A proposal resolved on the base now sees a flow that was edited after it.
    let (_, other) = propose_model(&api).await;
    let (status, body) = compare(&api, &other).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "stale_proposal");
}

#[tokio::test]
async fn gate_b_stops_a_hand_built_comparison_that_reads_the_test_rows() {
    let api = api().await;
    model_flow(&api).await;
    let (_, proposal) = propose_model(&api).await;
    let (_, comparison) = compare(&api, &proposal).await;
    let mut forged = comparison.clone();
    forged["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ6");
    forged.as_object_mut().unwrap().remove("compares");
    for edge in forged["edges"].as_array_mut().unwrap() {
        if edge["to"] == "cv_ml_linear_model.train" {
            edge["from"] = json!("split.test");
        }
    }
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(forged)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (run, attempts) = run_version(&api, "plv_01JABCDEFGHJKMNPQRSTVWXYZ6").await;
    assert_eq!(run["status"], "failed", "{run}");
    let ran: Vec<&str> = attempts
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["node_id"].as_str().unwrap())
        .collect();
    assert_eq!(ran, ["gate_b"], "no step runs after a failed gate");
    let checks = output(&api, &attempts, "gate_b", "checks").await;
    let leak = checks
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["check"] == "supervised.split_leakage@1.0.0")
        .unwrap();
    assert_eq!(leak["verdict"], "fail", "{leak}");
    assert!(
        leak["rationale"]
            .as_str()
            .unwrap()
            .starts_with("cv_ml_linear_model learns from the test set"),
        "{leak}"
    );
}

/// The model flow on rows whose target is age 40 or more, so a linear model can learn it.
async fn learnable_model_flow(api: &Api) {
    learnable_model_flow_barred(api, "balanced_accuracy").await;
}

/// The learnable model flow, its question's success bar stated in `metric`.
async fn learnable_model_flow_barred(api: &Api, metric: &str) {
    let model = json!({
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification"}
    });
    scaling_flow_barred(
        api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
        metric,
    )
    .await;
    let mut csv = String::from("age,returned_within_30d\n");
    for age in 20..60 {
        csv.push_str(&format!("{age},{}\n", u8::from(age >= 40)));
    }
    std::fs::write(&api.csv, csv).unwrap();
    let (run, _) = run_to_end(api).await;
    assert_eq!(run["status"], "succeeded", "{run}");
}

#[tokio::test]
async fn applying_the_comparisons_recommendation_needs_no_reason_and_cites_it() {
    let api = api().await;
    learnable_model_flow(&api).await;
    let (_, proposal) = propose_model(&api).await;
    let (_, comparison) = compare(&api, &proposal).await;
    let (run, attempts) = run_version(&api, comparison["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run}");
    let selection = output_artifact(&api, &attempts, "select_model", "decision").await;
    let decision = output(&api, &attempts, "select_model", "decision").await;
    assert_eq!(decision["winner"], "ml_linear_model", "{decision}");
    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );

    let other =
        json!({ "alternative_id": "ml_dummy_baseline", "idempotency_key": "test-apply-other" });
    let (status, body) = call(&api.app, "POST", &uri, Some(other)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "reason_required");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("it is not the comparison's recommendation, ml_linear_model"),
        "{body}"
    );

    let winner =
        json!({ "alternative_id": "ml_linear_model", "idempotency_key": "test-apply-winner" });
    let (status, applied) = call(&api.app, "POST", &uri, Some(winner)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    assert_eq!(applied["decision"]["selection_id"], selection);
}

async fn select_model(api: &Api, step: &str) -> (StatusCode, Value) {
    let uri = format!("/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ0/model_selection/{step}");
    call(&api.app, "POST", &uri, Some(json!({}))).await
}

#[tokio::test]
async fn sprisk_selects_a_model_by_itself_once_per_version() {
    let api = api().await;
    learnable_model_flow(&api).await;

    let (status, selection) = select_model(&api, "model").await;
    assert_eq!(status, StatusCode::CREATED, "{selection}");
    assert_eq!(
        selection["comparison"]["compares"],
        selection["proposal"]["id"]
    );
    assert_eq!(
        selection["run"]["pipeline_version_id"],
        selection["comparison"]["id"]
    );

    let (status, again) = select_model(&api, "model").await;
    assert_eq!(status, StatusCode::OK, "{again}");
    for part in ["proposal", "comparison", "run"] {
        assert_eq!(again[part]["id"], selection[part]["id"], "{part}");
    }

    let (run, attempts) = wait_run(&api, selection["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run}");
    let decision = output(&api, &attempts, "select_model", "decision").await;
    assert_eq!(decision["winner"], "ml_linear_model", "{decision}");
}

#[tokio::test]
async fn the_loop_back_rule_reads_the_results_the_chosen_model_was_compared_by() {
    let api = api().await;
    learnable_model_flow(&api).await;
    let loop_back = |version: &str| {
        format!("/pipeline_versions/{version}/methodology/proposals/model/evaluation.loop_back")
    };
    let base = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0";
    let (status, body) = call(&api.app, "POST", &loop_back(base), Some(json!({}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["errors"][0]["code"],
        "methodology_evidence_unavailable"
    );
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("compare the models first"),
        "{body}"
    );

    let (_, selection) = select_model(&api, "model").await;
    let (run, attempts) = wait_run(&api, selection["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run}");
    let decided = output(&api, &attempts, "select_model", "decision").await;
    assert_eq!(decided["winner"], "ml_linear_model", "{decided}");

    // Choosing the winner makes a new version, which the same comparison scored.
    let uri = format!(
        "/methodology_proposals/{}/apply",
        selection["proposal"]["id"].as_str().unwrap()
    );
    let choice =
        json!({ "alternative_id": "ml_linear_model", "idempotency_key": "test-loop-back" });
    let (status, applied) = call(&api.app, "POST", &uri, Some(choice)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    let chosen = applied["pipeline"]["id"].as_str().unwrap();

    let (status, proposal) = call(&api.app, "POST", &loop_back(chosen), Some(json!({}))).await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    assert_eq!(
        proposal["recommended_alternative_id"], "proceed",
        "{proposal}"
    );
    let proceed = &proposal["alternatives"][0];
    assert_eq!(proceed["applicability"], "applicable", "{proposal}");
    assert!(
        proceed["reason"]
            .as_str()
            .unwrap()
            .contains("meets the bar of 0.7"),
        "{proposal}"
    );
    let looks = proposal["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["label"] == "Looks at these folds")
        .unwrap();
    assert_eq!(
        looks["value"], "1",
        "choosing the winner is no new look: {proposal}"
    );
}

#[tokio::test]
async fn models_are_compared_by_the_metric_the_success_bar_is_stated_in() {
    let api = api().await;
    learnable_model_flow_barred(&api, "weighted_f1").await;

    let uri = format!("/pipeline_versions/{BASE}/model_selection/model");
    let (status, selection) = call(&api.app, "POST", &uri, Some(json!({}))).await;
    assert_eq!(status, StatusCode::CREATED, "{selection}");
    let metrics: Vec<&Value> = selection["comparison"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|n| n["params"].get("metric"))
        .collect();
    assert!(!metrics.is_empty(), "{selection}");
    assert!(metrics.iter().all(|m| *m == "weighted_f1"), "{selection}");
    let (run, attempts) = wait_run(&api, selection["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run}");
    let decision = output(&api, &attempts, "select_model", "decision").await;
    assert_eq!(decision["metric"], "weighted_f1", "{decision}");
}

#[tokio::test]
async fn a_model_step_with_costs_is_compared_by_expected_cost_and_each_candidate_has_them() {
    let api = api().await;
    let costs = json!({ "positive": "1", "false_negative": 5.0, "false_positive": 1.0 });
    let model = json!({
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification","costs":costs}
    });
    scaling_flow_into(
        &api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
    )
    .await;
    let mut csv = String::from("age,returned_within_30d\n");
    for age in 20..80 {
        csv.push_str(&format!("{age},{}\n", u8::from(age >= 50)));
    }
    std::fs::write(&api.csv, csv).unwrap();
    let (run, _) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let (status, selection) = select_model(&api, "model").await;
    assert_eq!(status, StatusCode::CREATED, "{selection}");
    for node in selection["comparison"]["nodes"].as_array().unwrap() {
        if node["operator"] == "sprisk.ml.cross_validate@4.0.0" {
            assert_eq!(node["params"]["metric"], "expected_cost", "{node}");
            assert_eq!(node["params"]["candidate_params"]["costs"], costs, "{node}");
        }
    }
    let (run, attempts) = wait_run(&api, selection["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run}");
    let decision = output(&api, &attempts, "select_model", "decision").await;
    assert_eq!(decision["metric"], "expected_cost", "{decision}");
    assert!(decision["positive_share"].is_number(), "{decision}");
}
#[tokio::test]
async fn only_a_model_step_that_has_run_has_a_model_selection() {
    let api = api().await;
    let model = json!({
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification"}
    });
    scaling_flow_into(
        &api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
    )
    .await;

    let (status, body) = select_model(&api, "model").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["errors"][0]["code"],
        "methodology_evidence_unavailable"
    );

    let (status, body) = select_model(&api, "split").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "not_compared");
}

#[tokio::test]
async fn another_model_can_be_tried_as_a_branch_and_test_row_reuse_is_recorded() {
    let api = api().await;
    learnable_model_flow(&api).await;
    let (_, selection) = select_model(&api, "model").await;
    let (run, _) = wait_run(&api, selection["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run}");
    let uri = format!(
        "/methodology_proposals/{}/apply",
        selection["proposal"]["id"].as_str().unwrap()
    );

    let first =
        json!({ "alternative_id": "ml_linear_model", "idempotency_key": "test-branch-linear" });
    let (status, linear) = call(&api.app, "POST", &uri, Some(first)).await;
    assert_eq!(status, StatusCode::CREATED, "{linear}");
    // The compared flow ran first, so its model had already scored the test rows.
    let base = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0";
    assert_eq!(
        linear["decision"]["test_rows_seen_by"],
        json!([base]),
        "{linear}"
    );
    let linear_version = linear["pipeline"]["id"].as_str().unwrap();
    let (run, _) = run_version(&api, linear_version).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let second = json!({ "alternative_id": "ml_dummy_baseline", "idempotency_key": "test-branch-dummy",
                         "reason": "To see the floor on the test rows." });
    let (status, dummy) = call(&api.app, "POST", &uri, Some(second)).await;
    assert_eq!(status, StatusCode::CREATED, "{dummy}");
    assert_eq!(
        dummy["pipeline"]["parent_id"],
        linear["pipeline"]["parent_id"]
    );
    assert_eq!(
        dummy["decision"]["test_rows_seen_by"],
        json!([base, linear_version])
    );
}

#[tokio::test]
async fn two_requests_at_once_share_one_model_selection_and_one_run() {
    let api = api().await;
    learnable_model_flow(&api).await;

    let ((one, first), (two, second)) =
        tokio::join!(select_model(&api, "model"), select_model(&api, "model"));

    assert!(one.is_success() && two.is_success(), "{first} {second}");
    for part in ["proposal", "comparison", "run"] {
        assert_eq!(first[part]["id"], second[part]["id"], "{part}");
    }
    let comparison = first["comparison"]["id"].as_str().unwrap();
    let (_, runs) = call(
        &api.app,
        "GET",
        &format!("/runs?pipeline_version_id={comparison}"),
        None,
    )
    .await;
    assert_eq!(runs.as_array().unwrap().len(), 1, "{runs}");
    let (_, versions) = call(&api.app, "GET", "/pipeline_versions", None).await;
    let comparisons = versions
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v.get("compares").is_some())
        .count();
    assert_eq!(comparisons, 1, "{versions}");
}

/// The clustering rule's proposal on a flow that loads and clusters: four alternatives,
/// k-means recommended.
async fn cluster_proposal(api: &Api) -> Value {
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
    proposal
}

#[tokio::test]
async fn an_apply_key_reused_for_another_choice_conflicts_instead_of_replaying_the_first() {
    // SCI-07: a retry gets the same version; a changed payload under the same key conflicts.
    let api = api().await;
    let proposal = cluster_proposal(&api).await;
    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let first = json!({ "alternative_id": "kmeans_centroid_clustering", "idempotency_key": "test-reused-key" });
    let (status, applied) = call(&api.app, "POST", &uri, Some(first)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");

    for changed in [
        json!({ "alternative_id": "dbscan_density_clustering", "idempotency_key": "test-reused-key",
                "reason": "The clusters are not convex." }),
        json!({ "alternative_id": "kmeans_centroid_clustering", "idempotency_key": "test-reused-key",
                "reason": "A reason the first request did not give." }),
    ] {
        let (status, body) = call(&api.app, "POST", &uri, Some(changed.clone())).await;
        assert_eq!(status, StatusCode::CONFLICT, "{changed}: {body}");
        assert_eq!(body["errors"][0]["code"], "conflict");
        assert!(
            body["errors"][0]["message"]
                .as_str()
                .unwrap()
                .contains("idempotency key test-reused-key was used for another request"),
            "{body}"
        );
    }
    let (_, decisions) = call(&api.app, "GET", "/methodology_decisions", None).await;
    assert_eq!(decisions.as_array().unwrap().len(), 1, "{decisions}");
}

#[tokio::test]
async fn two_applies_at_once_with_one_key_and_different_choices_make_one_decision() {
    let api = api().await;
    let proposal = cluster_proposal(&api).await;
    let uri = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let kmeans = json!({ "alternative_id": "kmeans_centroid_clustering", "idempotency_key": "test-raced-key" });
    let dbscan = json!({ "alternative_id": "dbscan_density_clustering", "idempotency_key": "test-raced-key",
                         "reason": "The clusters are not convex." });

    let ((one, first), (two, second)) = tokio::join!(
        call(&api.app, "POST", &uri, Some(kmeans)),
        call(&api.app, "POST", &uri, Some(dbscan))
    );

    // The loser is refused: as a conflicting key, or as stale once the winner's version exists.
    let refused = [StatusCode::CONFLICT, StatusCode::UNPROCESSABLE_ENTITY];
    let created = [one, two]
        .iter()
        .filter(|s| **s == StatusCode::CREATED)
        .count();
    assert_eq!(created, 1, "{first} {second}");
    assert!(
        refused.contains(&one) || refused.contains(&two),
        "{first} {second}"
    );
    let (_, decisions) = call(&api.app, "GET", "/methodology_decisions", None).await;
    assert_eq!(decisions.as_array().unwrap().len(), 1, "{decisions}");
}

const BASE: &str = "plv_01JABCDEFGHJKMNPQRSTVWXYZ0";

fn study_request(key: &str) -> Value {
    json!({
        "idempotency_key": key,
        "strategy": "grid",
        "seed": 0,
        "max_trials": 10,
        "max_wall_seconds": 600,
        "guardrails": [],
    })
}

async fn create_study(api: &Api, step: &str, request: Value) -> (StatusCode, Value) {
    let uri = format!("/pipeline_versions/{BASE}/studies/{step}");
    call(&api.app, "POST", &uri, Some(request)).await
}

/// Waits, bounded at ten minutes, for study `id` to end. German credit's study, whose models
/// tune their threshold inside every fold, takes about three when other tests run beside it.
async fn wait_study(api: &Api, id: &str) -> Value {
    for _ in 0..12_000 {
        let (_, detail) = call(&api.app, "GET", &format!("/studies/{id}"), None).await;
        if detail["study"]["status"] != "running" {
            return detail;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("study {id} did not end");
}

#[tokio::test]
async fn a_study_compares_the_shortlist_and_its_trials_are_read_from_the_run() {
    let api = api().await;
    learnable_model_flow(&api).await;

    let (status, detail) = create_study(&api, "model", study_request("study-key-0001")).await;
    assert_eq!(status, StatusCode::CREATED, "{detail}");
    let study = &detail["study"];
    assert_eq!(study["status"], "running");
    assert_eq!(study["pipeline_version_id"], BASE);
    assert_eq!(study["run_id"], detail["run"]["id"]);
    assert_eq!(detail["run"]["pipeline_version_id"], study["comparison_id"]);
    let (_, comparison) = call(
        &api.app,
        "GET",
        &format!(
            "/pipeline_versions/{}",
            study["comparison_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(comparison["compares"], study["proposal_id"]);
    // 40 train rows shortlist the baseline and the linear model; neither declares a search.
    let candidates: Vec<&str> = detail["trials"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["candidate"].as_str().unwrap())
        .collect();
    assert_eq!(
        candidates,
        ["ml_dummy_baseline", "ml_linear_model"],
        "{detail}"
    );
    for trial in detail["trials"].as_array().unwrap() {
        assert_eq!(trial["settings"], json!({}));
        assert_eq!(trial["study_id"], study["id"]);
    }

    let id = study["id"].as_str().unwrap();
    let done = wait_study(&api, id).await;
    assert_eq!(done["study"]["status"], "completed", "{done}");
    assert!(done["study"]["finished_at"].is_string());
    for trial in done["trials"].as_array().unwrap() {
        assert_eq!(trial["state"], "succeeded", "{trial}");
        assert_eq!(trial["attempts"].as_array().unwrap().len(), 1, "{trial}");
        assert!(
            trial["scores"].as_str().unwrap().starts_with("art_"),
            "{trial}"
        );
    }

    let (_, listed) = call(
        &api.app,
        "GET",
        &format!("/pipeline_versions/{BASE}/studies"),
        None,
    )
    .await;
    assert_eq!(listed, json!([done["study"]]));
}

#[tokio::test]
async fn a_study_key_replays_the_same_request_and_refuses_another() {
    let api = api().await;
    learnable_model_flow(&api).await;
    let (_, first) = create_study(&api, "model", study_request("study-key-0002")).await;

    let (status, again) = create_study(&api, "model", study_request("study-key-0002")).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["study"]["id"], first["study"]["id"]);
    assert_eq!(again["run"]["id"], first["run"]["id"]);

    let mut other = study_request("study-key-0002");
    other["max_trials"] = json!(11);
    let (status, refused) = create_study(&api, "model", other).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["errors"][0]["code"], "conflict");
}

#[tokio::test]
async fn two_study_requests_at_once_with_one_key_make_one_study_and_one_run() {
    let api = api().await;
    learnable_model_flow(&api).await;

    let ((one, first), (two, second)) = tokio::join!(
        create_study(&api, "model", study_request("study-key-0003")),
        create_study(&api, "model", study_request("study-key-0003")),
    );
    assert!(one.is_success() && two.is_success(), "{first} {second}");
    assert_eq!(first["study"]["id"], second["study"]["id"]);
    assert_eq!(first["run"]["id"], second["run"]["id"]);
    let (_, listed) = call(
        &api.app,
        "GET",
        &format!("/pipeline_versions/{BASE}/studies"),
        None,
    )
    .await;
    assert_eq!(listed.as_array().unwrap().len(), 1, "{listed}");
    let comparison = first["study"]["comparison_id"].as_str().unwrap();
    let (_, runs) = call(
        &api.app,
        "GET",
        &format!("/runs?pipeline_version_id={comparison}"),
        None,
    )
    .await;
    assert_eq!(runs.as_array().unwrap().len(), 1, "{runs}");
}

#[tokio::test]
async fn a_study_with_more_trials_than_its_budget_is_refused_and_no_study_or_run_is_stored() {
    let api = api().await;
    learnable_model_flow(&api).await;
    let mut request = study_request("study-key-0004");
    request["max_trials"] = json!(1);

    let (status, body) = create_study(&api, "model", request).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "over_budget");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("2 trials"),
        "{body}"
    );
    let (_, listed) = call(
        &api.app,
        "GET",
        &format!("/pipeline_versions/{BASE}/studies"),
        None,
    )
    .await;
    assert_eq!(listed, json!([]));
}

#[tokio::test]
async fn a_study_needs_a_budget_a_guardrail_in_range_and_a_model_step() {
    let api = api().await;
    learnable_model_flow(&api).await;
    let many = vec![json!({ "metric": "recall", "label": "1", "at_least": 0.5 }); 11];
    let long = json!([{ "metric": "recall", "label": "x".repeat(257), "at_least": 0.5 }]);
    let cases = [
        ("max_trials", json!(0), "invalid_budget"),
        ("max_trials", json!(201), "invalid_budget"),
        ("max_wall_seconds", json!(0), "invalid_budget"),
        (
            "max_wall_seconds",
            json!(1_000_000_000_000_u64),
            "invalid_budget",
        ),
        ("guardrails", json!(many), "invalid_guardrail"),
        ("guardrails", long, "invalid_guardrail"),
        (
            "guardrails",
            json!([{ "metric": "recall", "label": "1", "at_least": 1.5 }]),
            "invalid_guardrail",
        ),
    ];
    for (field, value, code) in cases {
        let mut request = study_request("study-key-0005");
        request[field] = value;
        let (status, body) = create_study(&api, "model", request).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{field}: {body}");
        assert_eq!(body["errors"][0]["code"], code, "{field}: {body}");
    }

    let (status, body) = create_study(&api, "split", study_request("study-key-0006")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "not_studied");

    let (status, body) = call(
        &api.app,
        "GET",
        "/studies/std_01JABCDEFGHJKMNPQRSTVWXYZ9",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn a_study_whose_trials_cannot_be_scored_ends_failed_with_its_trials() {
    let api = api().await;
    let model = json!({
        "id":"model", "operator":"sprisk.ml.linear_model@3.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification"}
    });
    scaling_flow_into(
        &api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
    )
    .await;
    // Three positive rows: the flow's model fits, but five stratified folds cannot be made.
    let mut csv = String::from("age,returned_within_30d\n");
    for age in 20..60 {
        csv.push_str(&format!("{age},{}\n", u8::from(age >= 57)));
    }
    std::fs::write(&api.csv, csv).unwrap();
    let (run, _) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let (status, detail) = create_study(&api, "model", study_request("study-key-0007")).await;
    assert_eq!(status, StatusCode::CREATED, "{detail}");
    let done = wait_study(&api, detail["study"]["id"].as_str().unwrap()).await;
    assert_eq!(done["study"]["status"], "failed", "{done}");
    assert!(done["study"]["finished_at"].is_string());
    let states: Vec<&str> = done["trials"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["state"].as_str().unwrap())
        .collect();
    assert!(states.contains(&"failed"), "{done}");
    assert!(!states.contains(&"running"), "{done}");
}

/// 200 rows whose class follows age in bands of 50 years: a forest learns it, a line cannot.
/// The flow's forest grows 10 trees, so studies of it stay quick.
async fn banded_forest_flow(api: &Api) {
    let model = json!({
        "id":"model", "operator":"sprisk.ml.random_forest@3.0.0",
        "params":{"target":"returned_within_30d","features":["age"],"task":"classification","n_estimators":10}
    });
    scaling_flow_into(
        api,
        &[model],
        &[json!({"from":"scale.train","to":"model.train"})],
    )
    .await;
    let mut csv = String::from("age,returned_within_30d\n");
    for age in 0..200 {
        csv.push_str(&format!("{age},{}\n", u8::from(age % 100 >= 50)));
    }
    std::fs::write(&api.csv, csv).unwrap();
    let (run, _) = run_to_end(api).await;
    assert_eq!(run["status"], "succeeded", "{run}");
}

async fn selection_decision(api: &Api, detail: &Value) -> Value {
    let (_, attempts) = call(
        &api.app,
        "GET",
        &format!("/runs/{}/attempts", detail["run"]["id"].as_str().unwrap()),
        None,
    )
    .await;
    let decision = output(api, &attempts, "select_model", "decision").await;
    parse::<sprisk_contracts::SelectionDecision>(&decision.to_string()).unwrap();
    decision
}

#[tokio::test(flavor = "multi_thread")]
async fn a_study_tunes_the_forest_on_inner_folds_and_a_rerun_reuses_its_trials() {
    let api = api().await;
    banded_forest_flow(&api).await;
    let mut request = study_request("study-key-0008");
    request["strategy"] = json!("random");
    request["seed"] = json!(3);
    request["max_trials"] = json!(4);
    request["guardrails"] = json!([{ "metric": "recall", "label": "1", "at_least": 0.0 }]);

    let (status, detail) = create_study(&api, "model", request.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{detail}");
    let trials = detail["trials"].as_array().unwrap();
    let candidates: Vec<&str> = trials
        .iter()
        .map(|t| t["candidate"].as_str().unwrap())
        .collect();
    assert_eq!(
        candidates,
        [
            "ml_dummy_baseline",
            "ml_linear_model",
            "ml_random_forest",
            "ml_random_forest"
        ],
        "{detail}"
    );
    // Two one-trial models leave 2 of the 4 trials for the forest's 9 settings.
    let forest: Vec<&Value> = trials
        .iter()
        .filter(|t| t["candidate"] == "ml_random_forest")
        .collect();
    for trial in &forest {
        let settings = trial["settings"].as_object().unwrap();
        assert_eq!(settings.len(), 2, "{trial}");
        assert!(settings.contains_key("min_samples_leaf") && settings.contains_key("max_features"));
    }
    assert_ne!(forest[0]["settings"], forest[1]["settings"]);

    let done = wait_study(&api, detail["study"]["id"].as_str().unwrap()).await;
    assert_eq!(done["study"]["status"], "completed", "{done}");
    let decision = selection_decision(&api, &done).await;
    let first = decision.clone();
    let tuned = decision["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "ml_random_forest")
        .unwrap_or_else(|| panic!("{decision}"));
    assert_eq!(
        tuned["fold_scores"].as_array().unwrap().len(),
        50,
        "{tuned}"
    );
    let searched = tuned["search"]["trials"].as_array().unwrap();
    assert_eq!(searched.len(), 2, "{tuned}");
    let chosen: u64 = searched
        .iter()
        .map(|t| t["chosen_in"].as_u64().unwrap())
        .sum();
    assert_eq!(chosen, 50, "every outer fold chose one trial");
    assert!(
        searched
            .iter()
            .any(|t| t["settings"] == tuned["search"]["settings"]),
        "{tuned}"
    );
    assert_eq!(tuned["guardrails"][0]["passed"], true, "{tuned}");
    assert_eq!(decision["guardrails"][0]["label"], "1");
    assert!(decision.get("earlier_looks").is_none(), "{decision}");

    // A second study with a new key and the same search runs nothing again.
    request["idempotency_key"] = json!("study-key-0009");
    let (status, again) = create_study(&api, "model", request).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    let again = wait_study(&api, again["study"]["id"].as_str().unwrap()).await;
    assert_eq!(again["study"]["status"], "completed", "{again}");
    let (_, attempts) = call(
        &api.app,
        "GET",
        &format!("/runs/{}/attempts", again["run"]["id"].as_str().unwrap()),
        None,
    )
    .await;
    for trial in again["trials"].as_array().unwrap() {
        let attempt = attempts
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["node_id"] == trial["node_id"])
            .unwrap();
        assert_eq!(attempt["state"], "cache_hit", "{trial}");
    }
    let rerun = selection_decision(&api, &again).await;
    assert_eq!(
        rerun["earlier_looks"],
        json!([done["study"]["comparison_id"]]),
        "{rerun}"
    );

    // Bands of age: a line cannot follow them, so the tuned forest is recommended. Using it
    // applies the settings the study chose for it.
    assert_eq!(first["winner"], "ml_random_forest", "{first}");
    let uri = format!(
        "/methodology_proposals/{}/apply",
        done["study"]["proposal_id"].as_str().unwrap()
    );
    let choice =
        json!({ "alternative_id": "ml_random_forest", "idempotency_key": "study-apply-0001" });
    let (status, applied) = call(&api.app, "POST", &uri, Some(choice)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    let model = applied["pipeline"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "model")
        .unwrap();
    for (setting, value) in tuned["search"]["settings"].as_object().unwrap() {
        assert_eq!(&model["params"][setting], value, "{model}");
    }
    assert_eq!(
        model["params"]["n_estimators"], 10,
        "the flow's own settings stay"
    );
    assert!(
        applied["decision"].get("missed_guardrails").is_none(),
        "{applied}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn using_a_model_that_missed_a_guardrail_records_what_it_missed() {
    let api = api().await;
    banded_forest_flow(&api).await;
    let mut request = study_request("study-key-0015");
    request["strategy"] = json!("random");
    request["seed"] = json!(3);
    request["max_trials"] = json!(4);
    // No model recalls every row of class 1 on every fold, so each one misses this bound.
    request["guardrails"] = json!([{ "metric": "recall", "label": "1", "at_least": 1.0 }]);
    let (status, detail) = create_study(&api, "model", request).await;
    assert_eq!(status, StatusCode::CREATED, "{detail}");
    let done = wait_study(&api, detail["study"]["id"].as_str().unwrap()).await;
    assert_eq!(done["study"]["status"], "completed", "{done}");
    let decision = selection_decision(&api, &done).await;
    let missed = decision["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "ml_linear_model" && c["guardrails"][0]["passed"] == false)
        .unwrap_or_else(|| panic!("{decision}"));

    let uri = format!(
        "/methodology_proposals/{}/apply",
        done["study"]["proposal_id"].as_str().unwrap()
    );
    let choice = json!({ "alternative_id": "ml_linear_model", "idempotency_key": "missed-0001",
                         "reason": "A linear model is required for review." });
    let (status, applied) = call(&api.app, "POST", &uri, Some(choice)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    assert_eq!(
        applied["decision"]["missed_guardrails"], missed["guardrails"],
        "{applied}"
    );
}

#[tokio::test]
async fn a_grid_larger_than_its_budget_and_a_random_budget_too_small_to_sample_are_refused() {
    let api = api().await;
    banded_forest_flow(&api).await;
    let mut grid = study_request("study-key-0010");
    grid["max_trials"] = json!(10);
    let (status, body) = create_study(&api, "model", grid).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "over_budget");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("this study has 11 trials"),
        "{body}"
    );

    let mut random = study_request("study-key-0011");
    random["strategy"] = json!("random");
    random["max_trials"] = json!(3);
    let (status, body) = create_study(&api, "model", random).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "over_budget");
    assert!(
        body["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("random search needs at least 2"),
        "{body}"
    );
}

#[tokio::test]
async fn a_guardrail_on_a_class_the_target_never_takes_fails_the_study() {
    let api = api().await;
    learnable_model_flow(&api).await;
    let mut request = study_request("study-key-0012");
    request["guardrails"] = json!([{ "metric": "recall", "label": "maybe", "at_least": 0.5 }]);
    let (status, detail) = create_study(&api, "model", request).await;
    assert_eq!(status, StatusCode::CREATED, "{detail}");
    let done = wait_study(&api, detail["study"]["id"].as_str().unwrap()).await;
    assert_eq!(done["study"]["status"], "failed", "{done}");
}

/// A clock that reads `at` for its first `reads` reads, then ten days later.
fn passing_after(reads: usize) -> sprisk_scheduler::Clock {
    let at: jiff::Timestamp = "2026-10-21T10:00:00Z".parse().unwrap();
    let read = std::sync::atomic::AtomicUsize::new(0);
    Arc::new(move || {
        let n = read.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if n < reads {
            at
        } else {
            at + jiff::SignedDuration::from_hours(240)
        }
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn a_study_past_its_wall_time_ends_budget_reached_and_keeps_its_finished_trial() {
    let python = root().join(".venv/bin/python");
    let command = vec![
        python.display().to_string(),
        "-m".into(),
        "sprisk_code.cells".into(),
    ];
    let host = session_host(&python);
    // One read sets the deadline; three more let ingest, the split and one trial start.
    let api = api_with_clock(
        python,
        Splitter::new(command, Duration::from_secs(30), 2),
        KERNEL_LIMITS,
        host,
        passing_after(4),
    )
    .await;
    banded_forest_flow(&api).await;
    let mut request = study_request("study-key-0013");
    request["max_trials"] = json!(11);

    let (status, detail) = create_study(&api, "model", request).await;
    assert_eq!(status, StatusCode::CREATED, "{detail}");
    let done = wait_study(&api, detail["study"]["id"].as_str().unwrap()).await;
    assert_eq!(done["study"]["status"], "budget_reached", "{done}");
    assert_eq!(done["study"]["deadline"], "2026-10-21T10:10:01Z", "{done}");
    assert_eq!(done["run"]["status"], "cancelled", "{done}");
    let mut states: Vec<&str> = done["trials"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["state"].as_str().unwrap())
        .collect();
    states.sort_unstable();
    let mut expected = vec!["not_started"; 10];
    expected.push("succeeded");
    expected.sort_unstable();
    assert_eq!(states, expected, "{done}");
}

/// German credit's rows in the test's CSV, and its question: tell good credit risks from bad,
/// with UCI's costs stated before anything runs.
async fn german_credit_question(api: &Api) {
    std::fs::copy(
        root().join("tests/fixtures/datasets/german_credit.csv"),
        &api.csv,
    )
    .unwrap();
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    q["objective"]["value"] = json!("Tell good credit risks from bad before a loan is granted.");
    q["target"]["value"] = json!("credit_risk");
    q["unit_of_analysis"]["value"] = json!("applicant");
    q["costs"] = json!({
        "value": { "positive": "bad", "false_negative": 5.0, "false_positive": 1.0 },
        "origin": "explicit"
    });
    let facts = q.as_object_mut().unwrap();
    facts.remove("time_column");
    facts.remove("entity_column");
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

/// German credit (Statlog, UCI): load -> keep the inputs -> stratified split -> encode the
/// text columns -> a 50-tree forest on `credit_risk`. The question states UCI's published costs before anything runs: a bad credit approved costs
/// 5, a good one refused costs 1. Nothing here is set from a result.
async fn german_credit_flow(api: &Api) {
    german_credit_question(api).await;
    // Sex and marital status, and nationality, are not inputs. Proxies of them are not tested.
    let inputs = [
        "credit_risk",
        "checking_status",
        "duration_months",
        "credit_history",
        "purpose",
        "credit_amount",
        "savings",
        "employment_since",
        "installment_rate",
        "other_debtors",
        "residence_since",
        "property",
        "age",
        "other_installment_plans",
        "housing",
        "existing_credits",
        "job",
        "people_liable",
        "telephone",
    ];
    // A model fits only the model (ADR-0056): text is encoded with the train rows' categories.
    let text = [
        "checking_status",
        "credit_history",
        "purpose",
        "savings",
        "employment_since",
        "other_debtors",
        "property",
        "other_installment_plans",
        "housing",
        "job",
        "telephone",
    ];
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    let nodes = flow["nodes"].as_array_mut().unwrap();
    nodes.push(json!({
        "id":"inputs", "operator":"sprisk.clean.select_columns@1.0.0",
        "params":{"columns":inputs}
    }));
    nodes.push(json!({
        "id":"split", "operator":"sprisk.validation.random_split@1.0.0",
        "params":{"test_fraction":0.25,"seed":42,"stratify":"credit_risk"}
    }));
    nodes.push(json!({
        "id":"categories", "operator":"sprisk.clean.encode@1.0.0",
        "params":{"columns":text}
    }));
    nodes.push(json!({
        "id":"model", "operator":"sprisk.ml.random_forest@3.0.0",
        "params":{"target":"credit_risk","task":"classification","n_estimators":50}
    }));
    flow["edges"] = json!([
        {"from":"load.data","to":"inputs.data"},
        {"from":"inputs.data","to":"split.data"},
        {"from":"split.train","to":"categories.train"},
        {"from":"split.test","to":"categories.test"},
        {"from":"categories.train","to":"model.train"}
    ]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

/// Gap 11's German credit case (ADR-0052, ADR-0053). A person puts the question's costs on
/// the model step. A study then tunes the forest by random
/// search and compares every model by expected cost on the train rows only. The test checks
/// how the comparison was made, not which model wins.
#[tokio::test(flavor = "multi_thread")]
async fn german_credit_study_compares_models_by_the_uci_costs_on_the_model() {
    let api = api().await;
    german_credit_flow(&api).await;
    let costs = json!({ "positive": "bad", "false_negative": 5.0, "false_positive": 1.0 });

    // A person put the costs on the forest, so the comparison is by expected cost.
    let (_, mut flow) = call(&api.app, "GET", &format!("/pipeline_versions/{BASE}"), None).await;
    let costed = "plv_01JABCDEFGHJKMNPQRSTVWXYZ8".to_owned();
    flow["id"] = json!(costed);
    let model = flow["nodes"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|n| n["id"] == "model")
        .unwrap();
    model["params"]["costs"] = costs.clone();
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (run, attempts) = run_version(&api, &costed).await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");

    let request = json!({
        "idempotency_key": "credit-study-0001", "strategy": "random", "seed": 7,
        "max_trials": 5, "max_wall_seconds": 3600, "guardrails": [],
    });
    let (status, detail) = call(
        &api.app,
        "POST",
        &format!("/pipeline_versions/{costed}/studies/model"),
        Some(request),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{detail}");
    let done = wait_study(&api, detail["study"]["id"].as_str().unwrap()).await;
    let study = &done["study"];
    assert_eq!(study["status"], "completed", "{done}");

    // Two one-trial models leave 3 of the 5 trials for the forest, each at its own settings.
    let forest: Vec<&Value> = done["trials"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["candidate"] == "ml_random_forest")
        .collect();
    assert_eq!(forest.len(), 3, "{done}");
    for trial in &forest {
        assert_eq!(trial["state"], "succeeded", "{trial}");
        let settings = trial["settings"].as_object().unwrap();
        assert_eq!(settings.len(), 2, "{trial}");
        assert!(settings.contains_key("min_samples_leaf") && settings.contains_key("max_features"));
    }
    assert!(
        forest[0]["settings"] != forest[1]["settings"]
            && forest[1]["settings"] != forest[2]["settings"]
            && forest[0]["settings"] != forest[2]["settings"],
        "{done}"
    );

    // Every model is scored by expected cost on the same 50 folds, with the same costs.
    let (_, comparison) = call(
        &api.app,
        "GET",
        &format!(
            "/pipeline_versions/{}",
            study["comparison_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    for node in comparison["nodes"].as_array().unwrap() {
        if node["id"].as_str().unwrap().starts_with("cv_") {
            assert_eq!(node["params"]["metric"], "expected_cost", "{node}");
            assert_eq!(node["params"]["candidate_params"]["costs"], costs, "{node}");
        }
    }
    let decision = selection_decision(&api, &done).await;
    assert_eq!(decision["metric"], "expected_cost", "{decision}");
    let share = decision["positive_share"].as_f64().unwrap();
    assert!((share - 0.3).abs() < 0.01, "UCI's 30% bad: {decision}");
    let candidates = decision["candidates"].as_array().unwrap();
    assert_eq!(candidates.len(), 3, "{decision}");
    for candidate in candidates {
        assert_eq!(
            candidate["fold_scores"].as_array().unwrap().len(),
            50,
            "{candidate}"
        );
    }
    // The floor is the cheaper constant decision. With 30% bad, refusing everyone costs a
    // good row's 1 for 70% of rows, less than approving everyone (5 for 30%).
    let floor = candidates
        .iter()
        .find(|c| c["id"] == "ml_dummy_baseline")
        .unwrap();
    let floor_mean = floor["mean"].as_f64().unwrap();
    assert!((floor_mean - (1.0 - share)).abs() < 0.01, "{floor}");
    // The forest's search is on record: each outer fold chose one of its 3 trials.
    let tuned = candidates
        .iter()
        .find(|c| c["id"] == "ml_random_forest")
        .unwrap();
    let searched = tuned["search"]["trials"].as_array().unwrap();
    assert_eq!(searched.len(), 3, "{tuned}");
    let chosen: u64 = searched
        .iter()
        .map(|t| t["chosen_in"].as_u64().unwrap())
        .sum();
    assert_eq!(chosen, 50, "every outer fold chose one trial");
    // A winner beat the floor on the corrected test; with none, no model did.
    let beats = |c: &Value| c["versus_baseline"]["beats_baseline"] == true;
    match decision["winner"].as_str() {
        Some(winner) => {
            let won = candidates.iter().find(|c| c["id"] == winner).unwrap();
            assert!(beats(won), "{decision}");
        }
        None => assert!(!candidates.iter().any(beats), "{decision}"),
    }

    // The study's graph reads the loaded rows only through the split, and its trials read
    // only the split's train rows. No step reads the split's test rows, and Gate B passes it.
    let edges = comparison["edges"].as_array().unwrap();
    let from = |port: &'static str| edges.iter().filter(move |e| e["from"] == port);
    assert!(
        from("load.data").all(|e| e["to"] == "inputs.data"),
        "{comparison}"
    );
    assert!(
        from("inputs.data").all(|e| e["to"] == "split.data"),
        "{comparison}"
    );
    assert_eq!(from("split.test").count(), 0, "{comparison}");
    let into_trials: Vec<&Value> = edges
        .iter()
        .filter(|e| e["to"].as_str().unwrap().starts_with("cv_"))
        .collect();
    assert_eq!(into_trials.len(), 5, "{comparison}");
    assert!(
        into_trials.iter().all(|e| e["from"] == "split.train"),
        "{comparison}"
    );
    let (_, attempts) = call(
        &api.app,
        "GET",
        &format!("/runs/{}/attempts", done["run"]["id"].as_str().unwrap()),
        None,
    )
    .await;
    let checks = output(&api, &attempts, "gate_b", "checks").await;
    let leakage = checks
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["check"] == "supervised.split_leakage@1.0.0")
        .unwrap_or_else(|| panic!("{checks}"));
    assert_eq!(leakage["verdict"], "pass", "{leakage}");

    // Using the forest writes its tuned settings, and keeps the costs, on the model step. A
    // reason is given, as using a model the study did not recommend needs one.
    let uri = format!(
        "/methodology_proposals/{}/apply",
        study["proposal_id"].as_str().unwrap()
    );
    let forest_choice = json!({ "alternative_id": "ml_random_forest", "idempotency_key": "credit-apply-0001",
                                "reason": "The forest is wanted for review beside the recommendation." });
    let (status, applied) = call(&api.app, "POST", &uri, Some(forest_choice)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");
    let model = applied["pipeline"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "model")
        .unwrap();
    assert_eq!(model["operator"], "sprisk.ml.random_forest@3.0.0");
    for (setting, value) in tuned["search"]["settings"].as_object().unwrap() {
        assert_eq!(&model["params"][setting], value, "{model}");
    }
    assert_eq!(model["params"]["costs"], costs, "{model}");
    assert_eq!(
        model["params"]["n_estimators"], 50,
        "the flow's own settings stay"
    );
    assert_eq!(
        applied["decision"]["selection_id"],
        output_artifact(&api, &attempts, "select_model", "decision").await
    );
}

/// German credit as stage notebooks (ADR-0055): steps keep a kind as their title, generic
/// variable names and their own stage; one chart per step reads the training rows; the
/// ready-made steps write themselves as plain Python with those names. A regression guard for
/// the whole notebook shape, through the API the app uses.
#[tokio::test(flavor = "multi_thread")]
async fn german_credit_runs_as_stage_notebooks_with_one_chart_per_step() {
    let api = api().await;
    german_credit_flow(&api).await;
    let (_, base) = call(&api.app, "GET", &format!("/pipeline_versions/{BASE}"), None).await;
    let mut flow = base.clone();
    flow["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ5");
    flow["parent_id"] = json!(BASE);
    let nodes = flow["nodes"].as_array_mut().unwrap();
    for node in nodes.iter_mut() {
        match node["id"].as_str().unwrap() {
            "load" => {
                node["title"] = json!("Load CSV");
                node["names"] = json!({"data": "df"});
            }
            "split" => {
                node["title"] = json!("Train/test split");
                node["names"] = json!({"train": "train", "test": "test"});
            }
            "model" => {
                node["title"] = json!("Random forest");
                node["names"] = json!({"model": "model"});
            }
            _ => {}
        }
    }
    nodes.push(json!({
        "id": "credit_amount_by_risk", "title": "Box plot", "stage": "explore",
        "operator": "sprisk.code.python@2.0.0",
        "params": {
            "source": "import plotly.express as px\n\npx.box(train, x=\"credit_risk\", y=\"credit_amount\")\n",
            "inputs": ["train"], "outputs": []
        }
    }));
    flow["edges"]
        .as_array_mut()
        .unwrap()
        .push(json!({"from": "split.train", "to": "credit_amount_by_risk.train"}));
    let (status, saved) = call(&api.app, "POST", "/pipeline_versions", Some(flow.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved, flow, "titles, names and stages are kept as sent");

    let (run, attempts) = run_version(&api, "plv_01JABCDEFGHJKMNPQRSTVWXYZ5").await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");
    let chart = output(&api, &attempts, "credit_amount_by_risk", "display").await;
    assert_eq!(
        chart["items"].as_array().unwrap().len(),
        1,
        "one chart: {chart}"
    );
    assert_eq!(chart["items"][0]["kind"], "figure", "{chart}");

    let split = flow["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "split")
        .unwrap();
    let request = json!({
        "settings": split["params"], "inputs": {"data": "df"},
        "outputs": {"train": "train", "test": "test"}
    });
    let uri = format!(
        "/operators/{}/notebook_code",
        split["operator"].as_str().unwrap()
    );
    let (status, code) = call(&api.app, "POST", &uri, Some(request)).await;
    assert_eq!(status, StatusCode::OK, "{code}");
    let code = code["code"].as_str().unwrap();
    assert!(
        code.ends_with("train, test = df[sorted(train_rows)], df[sorted(test_rows)]\n"),
        "{code}"
    );
}

/// Load → Split → Forest on a classification question with no time or entity column.
async fn forest_flow(api: &Api) {
    forest_flow_with(api, json!({})).await;
}

/// `forest_flow` whose question also states `facts`.
async fn forest_flow_with(api: &Api, facts: Value) {
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    let fields = q.as_object_mut().unwrap();
    fields.remove("time_column");
    fields.remove("entity_column");
    fields.extend(facts.as_object().unwrap().clone());
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    flow["nodes"].as_array_mut().unwrap().extend([
        json!({ "id":"split", "operator":"sprisk.validation.random_split@1.0.0",
                "params":{"test_fraction":0.25,"seed":42,"stratify":"returned_within_30d"} }),
        json!({ "id":"model", "operator":"sprisk.ml.random_forest@3.0.0",
                "params":{"target":"returned_within_30d","task":"classification","n_estimators":10} }),
    ]);
    flow["edges"] = json!([
        {"from":"load.data","to":"split.data"},
        {"from":"split.train","to":"model.train"}
    ]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut csv = String::from("age,returned_within_30d\n");
    for age in 20..80 {
        csv.push_str(&format!("{age},{}\n", u8::from(age >= 50)));
    }
    std::fs::write(&api.csv, csv).unwrap();
}

async fn review(api: &Api) -> Value {
    let uri = format!("/pipeline_versions/{BASE}/methodology/review");
    let (status, review) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::OK, "{review}");
    review
}

fn statuses(review: &Value) -> Vec<(String, String)> {
    review["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            (
                i["decides"].as_str().unwrap().to_owned(),
                i["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[tokio::test]
async fn before_a_run_the_review_orders_the_rules_that_measure_rows_after_those_shaping_them() {
    let api = api().await;
    forest_flow(&api).await;

    let review = review(&api).await;
    let expected: Vec<(String, String)> = [
        // The question, the data before the split and the split are methods' decisions, made
        // in the walk's look (ADR-0063); the Objective page asks what the question must say.
        ("modeling.estimator_selection", "needs_run"),
        // It reads the model selection's results, so it waits for the model step's rules.
        ("evaluation.loop_back", "waiting"),
    ]
    .iter()
    .map(|(d, s)| ((*d).to_owned(), (*s).to_owned()))
    .collect();
    assert_eq!(statuses(&review), expected, "{review}");
    assert_eq!(review["next"], json!([0]), "run the flow next: {review}");
}

#[tokio::test]
async fn after_a_run_the_review_decides_the_rules_that_measure_rows_and_lists_what_is_next() {
    let api = api().await;
    forest_flow(&api).await;
    let (run, _) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run}");

    let review = review(&api).await;
    let items = statuses(&review);
    assert!(!items.iter().any(|(_, s)| s == "needs_run"), "{review}");
    for at in review["next"].as_array().unwrap() {
        let status = &items[at.as_u64().unwrap() as usize].1;
        assert!(
            ["proposal", "needs_fact"].contains(&status.as_str()),
            "{review}"
        );
    }
    let uri = format!("/pipeline_versions/{BASE}/methodology/review");
    let (_, again) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(statuses(&again), items, "the review is deterministic");
}

#[tokio::test]
async fn a_flow_with_no_question_cannot_be_reviewed() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let uri = format!("/pipeline_versions/{BASE}/methodology/review");
    let (status, body) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "question_required", "{body}");
}

#[tokio::test]
async fn an_unknown_flow_has_no_review() {
    let api = api().await;
    let uri = format!("/pipeline_versions/{BASE}/methodology/review");
    let (status, body) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn a_step_that_carries_the_rule_s_applied_decision_is_settled() {
    let api = api().await;
    let proposal = cluster_proposal(&api).await;
    let other = proposal["alternatives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| {
            a["applicability"] == "applicable" && a["id"] != proposal["recommended_alternative_id"]
        })
        .unwrap();
    let apply = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let choice = json!({ "alternative_id": other["id"], "reason": "the person prefers it",
                         "idempotency_key": "review-override-1" });
    let (status, applied) = call(&api.app, "POST", &apply, Some(choice)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");

    let uri = format!(
        "/pipeline_versions/{}/methodology/review",
        applied["pipeline"]["id"].as_str().unwrap()
    );
    let (status, review) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::OK, "{review}");
    assert!(
        statuses(&review).contains(&(
            "clustering.algorithm_choice".to_owned(),
            "settled".to_owned()
        )),
        "{review}"
    );
}

/// ADR-0063 slice 6: "?" in a number column is marked missing in a step before the split,
/// then the column is read as numbers, both decided in the walk's look.
#[tokio::test(flavor = "multi_thread")]
async fn placeholders_are_marked_then_the_column_is_read_as_numbers_before_the_split() {
    let api = api().await;
    let mut csv = String::from("dose,batch,outcome\n");
    for (row, line) in learnable_table().lines().skip(1).enumerate() {
        let (dose, rest) = line.split_once(',').unwrap();
        let shown = if row % 25 == 0 { "?" } else { dose };
        csv.push_str(&format!("{shown},{rest}\n"));
    }
    std::fs::write(&api.csv, csv).unwrap();
    learnable_question(&api).await;
    let mut request = walk_request(&[&api.csv], "walk-markers");
    request["max_actions"] = json!(20);

    let detail = walk_to_end(&api, request).await;
    let steps = detail["steps"].as_array().unwrap();
    let decided = |key: &str| {
        steps
            .iter()
            .find(|s| s["decides"] == key)
            .unwrap_or_else(|| panic!("{key} is decided in the look: {detail}"))
    };
    let markers = decided("data.missing_markers");
    assert_eq!(markers["option"], "mark", "{detail}");
    assert_eq!(
        markers["effects"],
        json!([{ "kind": "insert_node", "node_id": "missing_markers", "before": "split",
                 "operator": "sprisk.clean.mark_missing@1.0.0",
                 "params": { "columns": ["dose"], "values": ["?"] } }]),
        "{detail}"
    );
    // The walk measures again once marked, so the column then reads as numbers in full.
    let types = decided("data.type_repair");
    assert_eq!(types["option"], "cast", "{detail}");
    assert_eq!(
        types["effects"][0]["params"],
        json!({ "columns": ["dose"] }),
        "{detail}"
    );
}

/// ADR-0063 slice 6: rows copying an earlier row are dropped before the split. The producer
/// counts them without reading the target; the step compares every column.
#[tokio::test(flavor = "multi_thread")]
async fn rows_copied_in_the_data_are_dropped_before_the_split() {
    let api = api().await;
    let mut csv = learnable_table();
    let first = csv.lines().nth(1).unwrap().to_owned();
    csv.push_str(&format!("{first}\n{first}\n"));
    std::fs::write(&api.csv, csv).unwrap();
    learnable_question(&api).await;
    let mut request = walk_request(&[&api.csv], "walk-copies");
    request["max_actions"] = json!(20);

    let detail = walk_to_end(&api, request).await;
    let steps = detail["steps"].as_array().unwrap();
    let copies = steps
        .iter()
        .find(|s| s["decides"] == "data.exact_duplicates")
        .unwrap_or_else(|| panic!("copies are decided in the look: {detail}"));
    assert_eq!(copies["option"], "drop", "{detail}");
    assert!(
        copies["reason"]
            .as_str()
            .unwrap()
            .starts_with("2 of 242 rows repeat an earlier row in every feature"),
        "{detail}"
    );
    // Every column is compared, the target too: same features with another label is no copy.
    assert_eq!(copies["effects"][0]["params"], json!({}), "{detail}");
}

/// ADR-0063 slice 6: the target is measured on the train rows in the look, so the task and the
/// class balance are settled before any rule acts, and the task's promise is checked.
#[tokio::test(flavor = "multi_thread")]
async fn the_look_settles_the_task_and_class_balance_from_the_train_rows() {
    let api = api().await;
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;
    let mut request = walk_request(&[&api.csv], "walk-target");
    request["max_actions"] = json!(30);

    let detail = walk_to_end(&api, request).await;
    let steps = detail["steps"].as_array().unwrap();
    let decided = |key: &str| steps.iter().find(|s| s["decides"] == key).cloned();
    let task = decided("question.task_type").expect("the task is decided in the look");
    assert_eq!(task["option"], "classification", "{detail}");
    assert_eq!(task["promises"], json!(["labels_are_classes"]), "{detail}");
    // Two classes whose stated mistakes cost the same: the costs go on the model, so models
    // are compared by expected cost, the success bar's metric.
    let costs = decided("question.error_costs").expect("the costs are decided");
    assert_eq!(costs["option"], "equal", "{detail}");
    let threshold = decided("evaluation.decision_threshold").expect("the threshold is decided");
    assert_eq!(threshold["option"], "cost_optimal_threshold", "{detail}");
    assert_eq!(
        threshold["effects"][0]["params"]["costs"],
        json!({ "positive": "responds", "false_negative": 1.0, "false_positive": 1.0 }),
        "{detail}"
    );
    let balance = decided("question.class_balance").expect("the balance is decided in the look");
    assert_eq!(balance["option"], "balanced", "{detail}");
    assert!(
        balance["reason"]
            .as_str()
            .unwrap()
            .starts_with("The rarest class holds"),
        "{detail}"
    );
    let checked = steps
        .iter()
        .filter(|s| s["action"] == "verify")
        .flat_map(|s| s["verifications"].as_array().unwrap().clone())
        .find(|c| c["verification"] == "labels_are_classes")
        .expect("the task's promise is checked");
    assert_eq!(checked["result"], "pass", "{detail}");
    // What the balance rests on: the target's shape, measured on the train rows (ADR-0064).
    let read = &balance["evidence"][0];
    assert_eq!(read["kind"], "target.shape", "{balance}");
    assert_eq!(read["step"], "target_shape", "{balance}");
    assert!(read["fields"]["rarest_share"].is_number(), "{balance}");
    let id = balance["methodology_decision_id"].as_str().unwrap();
    let (_, record) = call(
        &api.app,
        "GET",
        &format!("/methodology_decisions/{id}"),
        None,
    )
    .await;
    assert_eq!(record["evidence"], balance["evidence"], "{record}");
    let version = balance["pipeline_version_id"].as_str().unwrap();
    let uri = format!("/pipeline_versions/{version}/decisions");
    let (status, flow) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    let listed = flow["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["decides"] == "question.class_balance")
        .expect("the balance is listed");
    assert_eq!(listed["evidence"], balance["evidence"], "{flow}");
    assert!(
        listed["steps"]
            .as_array()
            .unwrap()
            .contains(&json!("target_shape")),
        "{flow}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn values_that_differ_only_in_case_are_lowercased_before_the_split() {
    let api = api().await;
    let mut csv = String::from("dose,batch,city,outcome\n");
    for (row, line) in learnable_table().lines().skip(1).enumerate() {
        let (dose_batch, outcome) = line.rsplit_once(',').unwrap();
        let city = ["Paris", "paris ", "Lyon"][row % 3];
        csv.push_str(&format!("{dose_batch},{city},{outcome}\n"));
    }
    std::fs::write(&api.csv, csv).unwrap();
    learnable_question(&api).await;
    let mut request = walk_request(&[&api.csv], "walk-spelling");
    request["max_actions"] = json!(4);

    let detail = walk_to_end(&api, request).await;
    let steps = detail["steps"].as_array().unwrap();
    let spelling = steps
        .iter()
        .find(|s| s["decides"] == "data.text_spelling")
        .expect("the spelling is decided in the look");
    assert_eq!(spelling["option"], "normalise", "{detail}");
    // One step before the split trims and lowercases the city; the target stays as typed.
    assert_eq!(
        spelling["effects"],
        json!([{ "kind": "insert_node", "node_id": "text_spelling", "before": "split",
                 "operator": "sprisk.clean.clean_text@1.0.0",
                 "params": { "lowercase": true, "empty_to_null": false,
                             "columns": ["city"], "exclude": ["outcome"] } }]),
        "{detail}"
    );
}
/// Rakuten's 27 product-type codes, rarest last: the challenge's classes are unbalanced.
const PRODUCT_TYPES: [u32; 27] = [
    2583, 1560, 1300, 2060, 2522, 1280, 2403, 2280, 1920, 1160, 1320, 10, 2705, 1140, 2582, 40,
    2585, 1302, 1281, 50, 2462, 2905, 60, 2220, 1301, 1940, 1180,
];

/// A word typical of each product type, as a title would carry ("lego" for toys).
const PRODUCT_WORDS: [&str; 27] = [
    "piscine",
    "meuble",
    "livre",
    "decoration",
    "papeterie",
    "jouet",
    "magazine",
    "figurine",
    "literie",
    "carte",
    "puericulture",
    "roman",
    "console",
    "poupee",
    "jardin",
    "jeu",
    "outillage",
    "bricolage",
    "peluche",
    "accessoire",
    "lot",
    "logiciel",
    "manette",
    "epicerie",
    "chaussons",
    "animalerie",
    "drone",
];

/// A synthetic stand-in shaped like Rakuten's listings joined to their codes (ADR-0060): a
/// nameless id column, a title, an often empty description, some of it HTML, product and image
/// ids, and the product type. Titles and descriptions carry a word of their class, never the code. Rows are
/// shuffled with a fixed seed before ids are given, so no id tells the class. No challenge row
/// is used: its data is confidential.
fn rakuten_like_listings() -> String {
    let mut rows = Vec::new();
    for (rank, (code, word)) in PRODUCT_TYPES.iter().zip(PRODUCT_WORDS).enumerate() {
        for n in 0..(40 - rank as u32) {
            // Scraped descriptions keep their markup, as Rakuten's do.
            let description = match n % 3 {
                0 => String::new(),
                1 => format!("{word} <b>neuf</b> &eacute;tat {}<br />", n % 5),
                _ => format!("{word} neuf taille {}", n % 5),
            };
            rows.push((format!("{word} modele {n}"), description, *code));
        }
    }
    // Fisher-Yates with a fixed linear congruential generator.
    let mut state: u64 = 42;
    for at in (1..rows.len()).rev() {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        rows.swap(at, (state >> 33) as usize % (at + 1));
    }
    let mut csv = String::from(",designation,description,productid,imageid,prdtypecode\n");
    for (row, (designation, description, code)) in rows.iter().enumerate() {
        csv.push_str(&format!(
            "{row},{designation},{description},{},{},{code}\n",
            100_000 + row,
            900_000 + row
        ));
    }
    csv
}

/// The question a person states for the stand-in: which product type each listing is.
async fn rakuten_like_question(api: &Api) {
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    q["objective"]["value"] =
        json!("Tell each listing's product type from its title and description.");
    q["target"]["value"] = json!("prdtypecode");
    q["unit_of_analysis"]["value"] = json!("listing");
    // What needs no data is stated before the walk, on the Objective page (ADR-0063 amendment).
    q["success_bar"] =
        json!({ "value": { "metric": "weighted_f1", "score": 0.5 }, "origin": "explicit" });
    q["interpretability"] = json!({ "value": "low", "origin": "explicit" });
    let facts = q.as_object_mut().unwrap();
    facts.remove("time_column");
    facts.remove("entity_column");
    facts.remove("prediction_horizon");
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

fn walk_request(sources: &[&Path], key: &str) -> Value {
    json!({
        "idempotency_key": key,
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "sources": sources,
        "max_actions": 40,
        "max_wall_seconds": 600,
    })
}

/// Starts a walk and waits, bounded, until it stops. Returns its detail.
async fn walk_to_end(api: &Api, request: Value) -> Value {
    let (status, walk) = call(&api.app, "POST", "/walks", Some(request)).await;
    assert!(
        status == StatusCode::ACCEPTED || status == StatusCode::OK,
        "{status} {walk}"
    );
    stopped(api, &walk).await
}

/// The detail of `walk` once it stops, waiting at most five minutes.
async fn stopped(api: &Api, walk: &Value) -> Value {
    let uri = format!("/walks/{}", walk["id"].as_str().unwrap());
    for _ in 0..6000 {
        let (_, detail) = call(&api.app, "GET", &uri, None).await;
        if detail["walk"]["status"] == "stopped" {
            return detail;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("walk {uri} did not stop");
}

fn trail(detail: &Value) -> Vec<String> {
    detail["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            let action = s["action"].as_str().unwrap();
            let chose = s["alternative_id"].as_str().or(s["option"].as_str());
            match (s["decides"].as_str(), chose) {
                (Some(decides), Some(alternative)) => format!("{action} {decides} {alternative}"),
                (Some(decides), None) => format!("{action} {decides}"),
                (None, _) => action.to_owned(),
            }
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn the_engine_builds_runs_and_judges_a_rakuten_shaped_flow_from_its_question_and_file() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-rakuten-0001")).await;
    // Built from the question and the file. The look runs it once and the methods decide the
    // split and the data steps before it (ADR-0063 slice 6), measuring again where a step
    // changed the rows they read; then each rule's change is applied, and the flow is run
    // again for the rules that measure its rows. Each run that changed the rows before the split checks the split's
    // promise again; vectorizing acts after the split, so its run does not.
    assert_eq!(
        trail(&detail),
        [
            "build",
            "measure",
            "run",
            "decide data.text_spelling keep",
            "decide data.repeated_items independent_rows",
            "decide split.method stratified_random",
            "measure",
            "run",
            "verify",
            "decide data.missing_markers keep",
            "decide data.type_repair keep",
            "decide data.join_sources single_source",
            "decide data.html_text strip",
            "measure",
            "run",
            "verify",
            "decide data.column_roles drop_identifiers",
            "measure",
            "run",
            "verify",
            "decide data.exact_duplicates keep",
            "decide features.text_representation vectorize_words",
            "measure",
            "run",
            "decide features.date_parts no_dates",
            "decide features.rare_categories keep_categories",
            "decide cleaning.missingness_strategy no_gaps",
            "decide features.wide_categories keep",
            "decide features.encoding_strategy no_encoding",
            "decide features.skew_transform no_transform",
            "decide features.scaling_strategy no_scaling",
            "decide question.task_type classification",
            "verify",
            "decide question.error_costs not_two_classes",
            "decide evaluation.decision_threshold default_half",
            "decide question.class_balance balanced",
            "compare modeling.estimator_selection",
            "apply modeling.estimator_selection ml_linear_model",
            "run",
            "score",
            "stop",
        ],
        "{detail}"
    );
    // The title and the description are free text, so they become words learnt from the
    // train rows (ADR-0058); empty descriptions give rows of zeros. Everything a person must
    // say was said up front, so the walk compares models, applies the best and scores the
    // test rows once.
    let stop = &detail["walk"]["stop"];
    assert_eq!(stop["reason"], "complete", "{detail}");
    assert!(
        stop["detail"]
            .as_str()
            .unwrap()
            .contains("Test rows, scored once"),
        "{detail}"
    );
    // No column is named as the title, so repeated titles are not measured, and the
    // decision says so.
    let steps = detail["steps"].as_array().unwrap();
    let repeated = steps
        .iter()
        .find(|s| s["decides"] == "data.repeated_items")
        .unwrap();
    assert!(
        repeated["reason"]
            .as_str()
            .unwrap()
            .starts_with("No column is named as the item's title"),
        "{detail}"
    );
    let head = &detail["walk"]["head_pipeline_version_id"];
    let scored = steps.iter().find(|s| s["action"] == "score").unwrap();
    assert_eq!(
        *head, scored["made_pipeline_version_id"],
        "the head is the version that scores the test rows"
    );
    let uri = format!("/pipeline_versions/{}", head.as_str().unwrap());
    let (_, flow) = call(&api.app, "GET", &uri, None).await;
    let edges: Vec<String> = flow["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            format!(
                "{} -> {}",
                e["from"].as_str().unwrap(),
                e["to"].as_str().unwrap()
            )
        })
        .collect();
    assert!(
        edges.contains(&"text_words.train_words -> model.words".to_owned()),
        "{edges:?}"
    );
    // Only the description holds markup; it is stripped on all rows, in front of the split,
    // and the identifiers are dropped after it.
    for edge in [
        "strip_html.data -> identifiers.data",
        "identifiers.data -> split.data",
    ] {
        assert!(edges.contains(&edge.to_owned()), "{edges:?}");
    }
    let strip = flow["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "strip_html")
        .unwrap();
    assert_eq!(strip["operator"], "sprisk.clean.strip_html@1.0.0");
    assert_eq!(
        strip["params"]["columns"],
        json!(["description"]),
        "{strip}"
    );

    // Same key: the same walk, nothing started.
    let (status, again) = call(
        &api.app,
        "POST",
        "/walks",
        Some(walk_request(&[&api.csv], "walk-rakuten-0001")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["id"], detail["walk"]["id"]);

    // Same question and file, a new walk: the same decisions in the same order, but the test
    // rows the first walk scored are not scored again.
    let second = walk_to_end(&api, walk_request(&[&api.csv], "walk-rakuten-0002")).await;
    let first_trail: Vec<String> = trail(&detail)
        .into_iter()
        .filter(|s| s != "score")
        .collect();
    assert_eq!(trail(&second), first_trail, "{second}");
    assert_eq!(second["walk"]["stop"]["reason"], "limitation", "{second}");
    assert!(
        second["walk"]["stop"]["detail"]
            .as_str()
            .unwrap()
            .contains("not scored again"),
        "{second}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_person_s_answer_is_taken_even_where_the_method_would_choose_another() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let (_, mut q) = call(
        &api.app,
        "GET",
        "/question_versions/qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        None,
    )
    .await;
    q["id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ1");
    q["parent_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    q["answers"] = json!([{ "decides": "split.method", "option": "simple_random" }]);
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut request = walk_request(&[&api.csv], "walk-answered-split");
    request["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ1");
    // The look measures and runs; text spelling and repeated items decide before the split.
    request["max_actions"] = json!(6);

    let detail = walk_to_end(&api, request).await;
    let steps = detail["steps"].as_array().unwrap();
    let split = steps
        .iter()
        .find(|s| s["decides"] == "split.method")
        .expect("the split is decided");
    // The method would stratify by class; the person's answer is applied instead.
    assert_eq!(split["option"], "simple_random", "{detail}");
    assert_eq!(split["assurance"], "confirmed", "{detail}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_method_s_decision_is_a_record_made_through_apply_and_cited_by_the_steps_it_changed() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let mut request = walk_request(&[&api.csv], "walk-method-records");
    request["max_actions"] = json!(6);

    let detail = walk_to_end(&api, request).await;
    let steps = detail["steps"].as_array().unwrap();
    let split = steps
        .iter()
        .find(|s| s["decides"] == "split.method")
        .expect("the split is decided");
    let id = split["methodology_decision_id"].as_str().expect("{detail}");
    let (status, decision) = call(
        &api.app,
        "GET",
        &format!("/methodology_decisions/{id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decision}");
    assert_eq!(decision["method"], split["method"], "{decision}");
    assert_eq!(decision["option"], split["option"], "{decision}");
    assert_eq!(decision["promises"], split["promises"], "{decision}");
    assert_eq!(
        decision["base_pipeline_version_id"],
        split["pipeline_version_id"]
    );
    let made = split["made_pipeline_version_id"]
        .as_str()
        .expect("the split step changes");
    assert_eq!(decision["pipeline_version_id"], made);
    let (_, version) = call(&api.app, "GET", &format!("/pipeline_versions/{made}"), None).await;
    let node = version["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "split")
        .unwrap();
    assert_eq!(node["methodology_decision_id"], id, "{version}");
    // A decision that changed no step is a record too.
    let binds = steps
        .iter()
        .find(|s| s["action"] == "decide" && s.get("made_pipeline_version_id").is_none())
        .expect("a decide step that changes no step");
    let id = binds["methodology_decision_id"].as_str().expect("{binds}");
    let (_, decision) = call(
        &api.app,
        "GET",
        &format!("/methodology_decisions/{id}"),
        None,
    )
    .await;
    assert!(decision.get("pipeline_version_id").is_none(), "{decision}");
}

/// Rakuten-shaped listings where each title is written twice, the second time in capitals,
/// as sellers relist one product.
fn rakuten_like_relistings() -> String {
    let mut csv = String::from(",designation,description,productid,imageid,prdtypecode\n");
    let mut row = 0;
    for (code, word) in PRODUCT_TYPES.iter().zip(PRODUCT_WORDS) {
        for n in 0..30u32 {
            let title = format!("{word} modele {}", n / 2);
            let title = if n % 2 == 0 {
                title
            } else {
                title.to_uppercase()
            };
            let description = format!("{word} neuf taille {}", n % 5);
            csv.push_str(&format!(
                "{row},{title},{description},{},{},{code}\n",
                100_000 + row,
                900_000 + row
            ));
            row += 1;
        }
    }
    csv
}

/// The relisted stand-in's question: the title column named, and what needs no data stated.
fn relisting_question(id: &str, parent: Option<&str>) -> Value {
    let mut q = question(id, parent);
    q["objective"]["value"] = json!("Tell each listing's product type from its title.");
    q["target"]["value"] = json!("prdtypecode");
    q["bindings"] = json!([stated("common.item_title", "designation")]);
    q["success_bar"] =
        json!({ "value": { "metric": "weighted_f1", "score": 0.5 }, "origin": "explicit" });
    q["interpretability"] = json!({ "value": "low", "origin": "explicit" });
    let facts = q.as_object_mut().unwrap();
    for gone in ["time_column", "entity_column", "prediction_horizon"] {
        facts.remove(gone);
    }
    q
}

#[tokio::test(flavor = "multi_thread")]
async fn the_look_asks_whether_matching_titles_are_one_item_then_the_answer_splits_by_item() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_relistings()).unwrap();
    let q = relisting_question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // The look: the producers are placed and the first flow runs once, before any rule acts.
    // No category text is typed several ways, so the spelling stays.
    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-relistings")).await;
    assert_eq!(
        trail(&detail),
        [
            "build",
            "measure",
            "run",
            "decide data.text_spelling keep",
            "decide data.missing_markers keep",
            "decide data.type_repair keep",
            "decide data.join_sources single_source",
            "decide data.html_text keep",
            "decide data.column_roles drop_identifiers",
            "measure",
            "run",
            "decide data.exact_duplicates keep",
            "stop",
        ],
        "{detail}"
    );
    let steps = detail["steps"].as_array().unwrap();
    let near = steps[1]["effects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["operator"] == "sprisk.profile.near_duplicates@1.0.0")
        .unwrap();
    assert_eq!(near["kind"], "add_node", "{detail}");
    assert_eq!(near["params"]["title_column"], "designation", "{detail}");
    // One list: the only open question is the one the data raised.
    let stop = &detail["walk"]["stop"];
    assert_eq!(stop["reason"], "needs_person", "{detail}");
    let asks = stop["asks"].as_array().unwrap();
    assert_eq!(asks.len(), 1, "{stop}");
    assert_eq!(asks[0]["decides"], "data.repeated_items");
    assert_eq!(asks[0]["method"], "methodology.common.repeated_items@1.0.0");
    assert_eq!(asks[0]["option"], "group_by_title");
    assert_eq!(asks[0]["options"].as_array().unwrap().len(), 3, "{stop}");
    // 15 titles per product type, each written twice: every row shares its title.
    assert!(
        asks[0]["question"]
            .as_str()
            .unwrap()
            .starts_with("810 of 810 rows share a title with another row (405 groups, largest 2)."),
        "{stop}"
    );

    // The person answers on a revised question, and the walk runs on without asking.
    let mut answered = relisting_question(
        "qv_01JABCDEFGHJKMNPQRSTVWXYZ1",
        Some("qv_01JABCDEFGHJKMNPQRSTVWXYZ0"),
    );
    answered["answers"] = json!([{ "decides": "data.repeated_items", "option": "group_by_title" }]);
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(answered)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut request = walk_request(&[&api.csv], "walk-relistings-answered");
    request["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ1");
    let detail = walk_to_end(&api, request).await;
    let walked = trail(&detail);
    assert_eq!(
        walked[..13],
        [
            "build",
            "measure",
            "run",
            "decide data.text_spelling keep",
            "decide data.repeated_items group_by_title",
            // The item is bound now, so column roles measures again, holding it out.
            "measure",
            "run",
            "decide split.method item_groups",
            "measure",
            "run",
            "verify",
            "decide data.missing_markers keep",
            "decide data.type_repair keep"
        ],
        "{detail}"
    );
    assert!(
        detail["walk"]["stop"].get("asks").is_none(),
        "nothing is asked again: {detail}"
    );
    assert_ne!(detail["walk"]["stop"]["reason"], "error", "{detail}");
    let steps = detail["steps"].as_array().unwrap();
    // The answer binds the item to the group column the producer adds, confirmed by a person.
    assert_eq!(steps[4]["assurance"], "confirmed", "{detail}");
    // The answer keeps what raised the question: the groups of matching titles.
    assert_eq!(
        steps[4]["evidence"][0]["kind"], "data.near_duplicate_groups",
        "{detail}"
    );
    assert_eq!(
        steps[4]["evidence"][0]["step"], "near_duplicates",
        "{detail}"
    );
    assert_eq!(
        steps[4]["bindings"],
        json!([{ "schema_version": "sprisk.binding/v1", "concept": "common.item_identity",
                 "source": { "column": "item_group", "step": "near_duplicates" },
                 "set_by": { "assurance": "confirmed",
                             "method": "methodology.common.repeated_items@1.0.0" } }])
    );
    // The split method replaces the split through a patch, and promises what it keeps.
    assert_eq!(steps[7]["assurance"], "rule", "{detail}");
    assert_eq!(
        steps[7]["promises"],
        json!(["no_group_overlap"]),
        "{detail}"
    );
    assert_eq!(
        steps[7]["effects"],
        json!([
            { "kind": "replace_node", "node_id": "split",
              "operator": "sprisk.validation.group_split@1.0.0",
              "params": { "group_column": "item_group", "test_fraction": 0.2, "seed": 42 } },
            { "kind": "set_input", "node_id": "split", "port": "data",
              "from": "near_duplicates.data" },
        ])
    );
    // The promise is checked on what the split wrote: no item is on both sides.
    let checks = steps[10]["verifications"].as_array().unwrap();
    let names: Vec<&str> = checks
        .iter()
        .map(|c| c["verification"].as_str().unwrap())
        .collect();
    // The task is decided once the rows before the split are final, so its promise comes later.
    assert_eq!(names, ["no_group_overlap"], "{detail}");
    let overlap = &checks[0];
    assert_eq!(overlap["result"], "pass", "{detail}");
    assert_eq!(overlap["step"], "group_overlap", "{detail}");
    assert_eq!(steps[10]["run_id"], steps[9]["run_id"], "{detail}");
    // The promise's producer reads what the split wrote, whatever code wrote it.
    let overlap_added = steps[8]["effects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["node_id"] == "group_overlap")
        .unwrap_or_else(|| panic!("{detail}"));
    assert_eq!(
        *overlap_added,
        json!({ "kind": "add_node", "node_id": "group_overlap",
                "operator": "sprisk.validation.group_overlap@1.0.0",
                "params": { "group_column": "item_group" },
                "inputs": { "test": "split.test", "train": "split.train" } }),
        "{detail}"
    );

    // The split reads rows that passed through the producer, which stays on the rows it
    // measured: later rules may add steps between them.
    let head = detail["walk"]["head_pipeline_version_id"].as_str().unwrap();
    let (_, flow) = call(&api.app, "GET", &format!("/pipeline_versions/{head}"), None).await;
    let source_of = |port: &str| {
        flow["edges"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["to"] == port)
            .map(|e| e["from"].clone())
    };
    let mut upstream = Vec::new();
    let mut port = "split.data".to_owned();
    while let Some(from) = source_of(&port) {
        let step = from.as_str().unwrap().split('.').next().unwrap().to_owned();
        port = format!("{step}.data");
        upstream.push(step);
    }
    assert!(upstream.contains(&"near_duplicates".to_owned()), "{flow}");
    assert_eq!(upstream.last().map(String::as_str), Some("load"), "{flow}");
    let split = flow["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "split")
        .unwrap();
    assert_eq!(split["operator"], "sprisk.validation.group_split@1.0.0");

    // What decided the flow: each decision with its activity, and the split's promise, which
    // holds on the head.
    let head = detail["walk"]["head_pipeline_version_id"].as_str().unwrap();
    let uri = format!("/pipeline_versions/{head}/decisions");
    let (status, decided) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert_eq!(decided["walk_id"], detail["walk"]["id"], "{decided}");
    let by_split = decided["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["decides"] == "split.method")
        .unwrap();
    assert_eq!(by_split["activity"], "Fair evaluation", "{decided}");
    assert_eq!(by_split["name"], "Train/test split", "{decided}");
    assert_eq!(by_split["promises"][0]["status"], "pass", "{decided}");

    // A person edits the split's seed in a child version: the promise is stale there.
    let mut edited = flow.clone();
    edited["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ9");
    edited["parent_id"] = json!(head);
    for node in edited["nodes"].as_array_mut().unwrap() {
        if node["id"] == "split" {
            node["params"]["seed"] = json!(7);
        }
    }
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(edited)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let uri = "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ9/decisions";
    let (_, decided) = call(&api.app, "GET", uri, None).await;
    let by_split = decided["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["decides"] == "split.method")
        .unwrap();
    assert_eq!(by_split["promises"][0]["status"], "stale", "{decided}");
    assert_eq!(by_split["promises"][0]["last_result"], "pass", "{decided}");
}

#[tokio::test]
async fn a_flow_no_walk_made_has_no_decisions() {
    let api = api().await;
    let (status, body) = call(
        &api.app,
        "POST",
        "/pipeline_versions",
        Some(pipeline(&api.csv)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let uri = format!(
        "/pipeline_versions/{}/decisions",
        body["id"].as_str().unwrap()
    );
    let (status, decided) = call(&api.app, "GET", &uri, None).await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert!(decided.get("walk_id").is_none(), "{decided}");
    assert_eq!(decided["decisions"], json!([]), "{decided}");
    let (status, _) = call(
        &api.app,
        "GET",
        "/pipeline_versions/plv_01JABCDEFGHJKMNPQRSTVWXYZ8/decisions",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_walk_with_no_stated_target_stops_before_building_anything() {
    let api = api().await;
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    q["target"]["origin"] = json!("inferred");
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (status, walk) = call(
        &api.app,
        "POST",
        "/walks",
        Some(walk_request(&[&api.csv], "walk-no-target")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{walk}");
    assert_eq!(walk["status"], "stopped");
    assert_eq!(walk["stop"]["reason"], "needs_person");
    assert!(walk.get("head_pipeline_version_id").is_none(), "{walk}");
    let (_, versions) = call(&api.app, "GET", "/pipeline_versions", None).await;
    assert_eq!(versions, json!([]), "nothing is built");
}

#[tokio::test]
async fn a_walk_reads_only_files_inside_the_data_roots() {
    let api = api().await;
    rakuten_like_question(&api).await;
    let outside = Path::new("/etc/hosts.csv");
    let (status, body) = call(
        &api.app,
        "POST",
        "/walks",
        Some(walk_request(&[outside], "walk-outside")),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = call(
        &api.app,
        "POST",
        "/walks",
        Some(walk_request(&[Path::new("/data/x.xlsx")], "walk-xlsx")),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "invalid_walk", "{body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_walk_stops_when_it_has_taken_its_actions() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let mut request = walk_request(&[&api.csv], "walk-one-action");
    request["max_actions"] = json!(1);
    let detail = walk_to_end(&api, request).await;
    assert_eq!(
        trail(&detail),
        ["build", "measure", "stop"],
        "placing the look's producers is its one action: {detail}"
    );
    assert_eq!(
        detail["walk"]["stop"]["reason"], "budget_exhausted",
        "{detail}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_walk_stops_when_its_time_is_up() {
    let python = root().join(".venv/bin/python");
    let command = vec![
        python.display().to_string(),
        "-m".into(),
        "sprisk_code.cells".into(),
    ];
    let host = session_host(&python);
    // Two reads stamp the walk and its build step; the first round finds ten days gone.
    let api = api_with_clock(
        python,
        Splitter::new(command, Duration::from_secs(30), 2),
        KERNEL_LIMITS,
        host,
        passing_after(2),
    )
    .await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-no-time")).await;
    assert_eq!(trail(&detail), ["build", "stop"], "{detail}");
    assert_eq!(
        detail["walk"]["stop"]["reason"], "budget_exhausted",
        "{detail}"
    );
}

#[tokio::test]
async fn a_walk_needs_a_bounded_budget_and_its_own_key() {
    let api = api().await;
    rakuten_like_question(&api).await;
    for (field, value) in [("max_actions", 0), ("max_wall_seconds", 8 * 24 * 60 * 60)] {
        let mut request = walk_request(&[&api.csv], "walk-budget");
        request[field] = json!(value);
        let (status, body) = call(&api.app, "POST", "/walks", Some(request)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["errors"][0]["code"], "invalid_budget", "{body}");
    }

    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ1", None);
    q["target"]["origin"] = json!("inferred");
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut request = walk_request(&[&api.csv], "walk-key-reused");
    request["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ1");
    let (status, body) = call(&api.app, "POST", "/walks", Some(request.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    request["max_actions"] = json!(3);
    let (status, body) = call(&api.app, "POST", "/walks", Some(request)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_walk_whose_head_someone_else_changes_stops_as_stale() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    // Stored, not yet driven: a person saves a version on the walk's first flow before its
    // first round reviews it.
    let (walk, head) = walk_left_walking(&api).await;
    let (_, mut edited) = call(&api.app, "GET", &format!("/pipeline_versions/{head}"), None).await;
    edited["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ5");
    edited["parent_id"] = json!(head);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(edited)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(resume_walks(&api.state).await.unwrap(), 1);
    let walk = serde_json::to_value(&walk).unwrap();

    let detail = stopped(&api, &walk).await;
    assert_eq!(detail["walk"]["stop"]["reason"], "stale", "{detail}");
    assert_eq!(
        trail(&detail),
        ["build", "stop"],
        "nothing applied on a changed head: {detail}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_walk_whose_source_changes_stops_as_source_changed() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let (status, walk) = call(
        &api.app,
        "POST",
        "/walks",
        Some(walk_request(&[&api.csv], "walk-source-changed")),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{walk}");
    let hashes = walk["source_hashes"].as_array().unwrap();
    assert_eq!(hashes.len(), 1, "{walk}");
    assert!(hashes[0].as_str().unwrap().starts_with("sha256:"), "{walk}");
    // Someone saves new rows over the file while the walk is going.
    let mut edited = rakuten_like_listings();
    edited.push_str("9999,new listing,,1,1,10\n");
    std::fs::write(&api.csv, edited).unwrap();

    let detail = stopped(&api, &walk).await;
    assert_eq!(
        detail["walk"]["stop"]["reason"], "source_changed",
        "{detail}"
    );
    let why = detail["walk"]["stop"]["detail"].as_str().unwrap();
    assert!(why.contains("d.csv"), "{why}");
}

/// The registry's role defaults, as the engine reads them.
fn defaults(state: &AppState) -> sprisk_methodology::Defaults {
    sprisk_methodology::Defaults::of(&state.registry).unwrap()
}

/// A walk still walking, as a stopped server leaves it: built, its head the first flow, and
/// nothing driving it. Gives the walk and its head.
async fn walk_left_walking(api: &Api) -> (sprisk_contracts::Walk, String) {
    let question = api
        .store
        .get_question_version(&parse("\"qv_01JABCDEFGHJKMNPQRSTVWXYZ0\"").unwrap())
        .await
        .unwrap();
    let sources = vec![api.csv.display().to_string()];
    let sprisk_methodology::engine::Start::Flow { nodes, edges } =
        sprisk_methodology::engine::start(&question, &sources, &defaults(&api.state)).unwrap()
    else {
        panic!("the question states a target");
    };
    let head = "plv_01JABCDEFGHJKMNPQRSTVWXYZ7";
    let mut flow = pipeline(&api.csv);
    flow["id"] = json!(head);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    flow["nodes"] = json!(nodes);
    flow["edges"] = json!(edges);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let walk = json!({
        "schema_version": "sprisk.walk/v1", "id": "wlk_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0", "sources": sources,
        "source_hashes": [sprisk_artifacts::file_hash(&api.csv).await.unwrap()],
        "max_actions": 40, "max_wall_seconds": 600, "status": "walking",
        "head_pipeline_version_id": head, "created_at": stamp_now(),
    });
    let walk: sprisk_contracts::Walk = parse(&walk.to_string()).unwrap();
    let request = walk_request(&[&api.csv], "walk-restarted");
    let request: sprisk_contracts::CreateWalk = parse(&request.to_string()).unwrap();
    let built = walk_step(
        &walk,
        0,
        "build",
        json!({ "made_pipeline_version_id": head }),
    );
    api.store
        .insert_walk(&walk, &request, None, &built)
        .await
        .unwrap();
    (walk, head.to_owned())
}

/// Now, to whole seconds: the server's clock is the system clock, so a walk saved with a fixed
/// time would run out of its wall-clock budget once that time is past.
fn stamp_now() -> String {
    jiff::Timestamp::from_second(jiff::Timestamp::now().as_second())
        .unwrap()
        .to_string()
}

fn walk_step(
    walk: &sprisk_contracts::Walk,
    round: u32,
    action: &str,
    extra: Value,
) -> sprisk_contracts::WalkStep {
    let mut step = json!({
        "schema_version": "sprisk.walk_step/v1", "walk_id": walk.id, "round": round,
        "action": action, "reason": "before the restart", "created_at": walk.created_at,
    });
    step.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    parse(&step.to_string()).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_server_finishes_its_walks_without_a_second_run_for_a_round() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let (walk, head) = walk_left_walking(&api).await;
    // The server stopped while round 1's run was still queued.
    let run_id = "run_01JABCDEFGHJKMNPQRSTVWXYZ7";
    let queued = json!({
        "schema_version": "sprisk.run/v1", "id": run_id,
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0", "pipeline_version_id": head,
        "status": "queued", "created_at": "2026-10-23T10:00:01Z",
    });
    let ran = walk_step(
        &walk,
        1,
        "run",
        json!({ "pipeline_version_id": head, "run_id": run_id }),
    );
    api.store
        .record_walk_run(&walk, &ran, &parse(&queued.to_string()).unwrap(), None)
        .await
        .unwrap();

    assert_eq!(resume_walks(&api.state).await.unwrap(), 1);
    let detail = stopped(&api, &serde_json::to_value(&walk).unwrap()).await;

    // The left run is driven to its end. The first flow's baseline meets raw text and fails,
    // as in any Rakuten walk; the rules act on what it produced.
    let (_, run) = call(&api.app, "GET", &format!("/runs/{run_id}"), None).await;
    assert!(run["finished_at"].is_string(), "{run}");
    let steps = detail["steps"].as_array().unwrap();
    let runs_of_round_one = steps.iter().filter(|s| s["round"] == 1).count();
    assert_eq!(runs_of_round_one, 1, "{detail}");
    // The walk goes on from the run: the look places the producers the first flow lacks, and
    // the methods decide on what they measured.
    assert_eq!(steps[2]["action"], "measure", "{detail}");
    assert!(steps.iter().any(|s| s["action"] == "decide"), "{detail}");
    assert_ne!(detail["walk"]["stop"]["reason"], "error", "{detail}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_walk_finishes_scoring_its_test_rows_and_ends_on_that_score() {
    let api = api().await;
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;
    let (mut walk, head) = walk_left_walking(&api).await;
    // The server stopped while round 1 scored the test rows.
    let head_id: sprisk_contracts::PipelineVersionId = parse(&json!(head).to_string()).unwrap();
    let base = api.store.get_pipeline_version(&head_id).await.unwrap();
    let (nodes, edges) =
        sprisk_methodology::engine::with_test_scoring(&base, &defaults(&api.state)).unwrap();
    let scored_id = "plv_01JABCDEFGHJKMNPQRSTVWXYZ8";
    let mut scored = serde_json::to_value(&base).unwrap();
    scored["id"] = json!(scored_id);
    scored["parent_id"] = json!(head);
    scored["nodes"] = json!(nodes);
    scored["edges"] = json!(edges);
    let run_id = "run_01JABCDEFGHJKMNPQRSTVWXYZ8";
    let queued = json!({
        "schema_version": "sprisk.run/v1", "id": run_id,
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0", "pipeline_version_id": scored_id,
        "status": "queued", "created_at": "2026-10-23T10:00:01Z",
    });
    let made = json!({
        "pipeline_version_id": head, "made_pipeline_version_id": scored_id, "run_id": run_id,
    });
    let step = walk_step(&walk, 1, "score", made);
    walk.head_pipeline_version_id = Some(parse(&json!(scored_id).to_string()).unwrap());
    let queued = parse(&queued.to_string()).unwrap();
    let scored = parse(&scored.to_string()).unwrap();
    api.store
        .record_walk_run(&walk, &step, &queued, Some(&scored))
        .await
        .unwrap();

    assert_eq!(resume_walks(&api.state).await.unwrap(), 1);
    let detail = stopped(&api, &serde_json::to_value(&walk).unwrap()).await;

    assert_eq!(detail["walk"]["stop"]["reason"], "complete", "{detail}");
    assert_eq!(trail(&detail), ["build", "score", "stop"], "{detail}");
    let why = detail["walk"]["stop"]["detail"].as_str().unwrap();
    assert!(why.contains("Test rows, scored once"), "{why}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_walk_takes_up_the_apply_it_saved_before_its_step() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let (walk, head) = walk_left_walking(&api).await;
    // The head was run, then round 1 applied a rule that reads its rows, and the server
    // stopped before it recorded the step.
    let (status, run) = call(
        &api.app,
        "POST",
        "/runs",
        Some(json!({ "pipeline_version_id": head })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    let run_uri = format!("/runs/{}", run["id"].as_str().unwrap());
    for _ in 0..400 {
        let (_, body) = call(&api.app, "GET", &run_uri, None).await;
        if body["finished_at"].is_string() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let uri = format!(
        "/pipeline_versions/{head}/methodology/proposals/model/modeling.estimator_selection"
    );
    let (status, proposal) = call(&api.app, "POST", &uri, Some(json!({}))).await;
    assert_eq!(status, StatusCode::CREATED, "{proposal}");
    let apply = format!(
        "/methodology_proposals/{}/apply",
        proposal["id"].as_str().unwrap()
    );
    let choice = json!({
        "alternative_id": proposal["alternatives"][0]["id"],
        "idempotency_key": format!("{}-round-1", walk.id.as_str()),
        "reason": "Chosen before the comparison ran.",
    });
    let (status, applied) = call(&api.app, "POST", &apply, Some(choice)).await;
    assert_eq!(status, StatusCode::CREATED, "{applied}");

    assert_eq!(resume_walks(&api.state).await.unwrap(), 1);
    let detail = stopped(&api, &serde_json::to_value(&walk).unwrap()).await;

    // Not stale: the version its head gained is the one its own round made.
    let steps = detail["steps"].as_array().unwrap();
    assert_eq!(steps[1]["action"], "apply", "{detail}");
    assert_eq!(
        steps[1]["methodology_decision_id"], applied["decision"]["id"],
        "{detail}"
    );
    assert_ne!(detail["walk"]["stop"]["reason"], "stale", "{detail}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_question_s_walks_are_found_by_the_question_newest_first() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let mut made = Vec::new();
    for key in ["walk-found-1", "walk-found-2"] {
        let mut request = walk_request(&[&api.csv], key);
        request["max_actions"] = json!(1);
        let (status, walk) = call(&api.app, "POST", "/walks", Some(request)).await;
        assert_eq!(status, StatusCode::ACCEPTED, "{walk}");
        made.push(walk["id"].clone());
    }

    let uri = "/walks?question_version_id=qv_01JABCDEFGHJKMNPQRSTVWXYZ0&limit=1";
    let (status, page) = call(&api.app, "GET", uri, None).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    let ids: Vec<&Value> = page.as_array().unwrap().iter().map(|w| &w["id"]).collect();
    assert_eq!(ids, vec![&made[1]]);
    let (_, other) = call(
        &api.app,
        "GET",
        "/walks?question_version_id=qv_01JABCDEFGHJKMNPQRSTVWXYZ9",
        None,
    )
    .await;
    assert_eq!(other, json!([]));
    let (status, bad) = call(&api.app, "GET", "/walks?question_version_id=nope", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_walk_takes_up_the_method_decision_it_saved_before_its_step() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let (walk, head) = walk_left_walking(&api).await;
    // Round 1 took a method's option through Apply, and the server stopped before it
    // recorded the step.
    let base = api
        .store
        .get_pipeline_version(&parse(&json!(head).to_string()).unwrap())
        .await
        .unwrap();
    let mut made = base.clone();
    made.id = parse("\"plv_01JABCDEFGHJKMNPQRSTVWXYZ8\"").unwrap();
    made.parent_id = Some(base.id.clone());
    let decision: sprisk_contracts::MethodologyDecision = parse(
        &json!({
            "schema_version": "sprisk.methodology_decision/v1",
            "id": "mdc_01JABCDEFGHJKMNPQRSTVWXYZ8",
            "method": "methodology.supervised.split_method@1.0.0", "decides": "split.method",
            "option": "stratified_random", "assurance": "rule", "reason": "Each class keeps its share.",
            "question_version_id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "base_pipeline_version_id": head, "pipeline_version_id": made.id,
            "created_at": stamp_now(),
        })
        .to_string(),
    )
    .unwrap();
    let key = format!("{}-round-1", walk.id.as_str());
    api.store
        .apply_methodology_decision(&decision, Some(&made), &key)
        .await
        .unwrap();

    assert_eq!(resume_walks(&api.state).await.unwrap(), 1);
    let detail = stopped(&api, &serde_json::to_value(&walk).unwrap()).await;

    // Not stale: the version its head gained is the one its own round made.
    let steps = detail["steps"].as_array().unwrap();
    assert_eq!(steps[1]["action"], "decide", "{detail}");
    assert_eq!(
        steps[1]["methodology_decision_id"],
        "mdc_01JABCDEFGHJKMNPQRSTVWXYZ8"
    );
    assert_eq!(steps[1]["made_pipeline_version_id"], made.id.as_str());
    assert_ne!(detail["walk"]["stop"]["reason"], "stale", "{detail}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_walk_that_cannot_take_its_next_step_stops_with_the_error() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let (status, walk) = call(
        &api.app,
        "POST",
        "/walks",
        Some(walk_request(&[&api.csv], "walk-error")),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{walk}");
    // The source goes before the walk runs the flow, so its run cannot start.
    std::fs::remove_file(&api.csv).unwrap();

    let detail = stopped(&api, &walk).await;
    assert_eq!(detail["walk"]["stop"]["reason"], "error", "{detail}");
    let why = detail["walk"]["stop"]["detail"].as_str().unwrap();
    assert!(why.contains("could not take its next step"), "{why}");
}

/// Rakuten's own shape: the listings in one file and their product types in another, keyed by
/// the nameless row index. Written next to the test's CSV, inside the data roots.
fn rakuten_like_files(api: &Api) -> (PathBuf, PathBuf) {
    let (mut listings, mut codes) = (String::new(), String::new());
    for line in rakuten_like_listings().lines() {
        let (row, code) = line.rsplit_once(',').unwrap();
        listings.push_str(row);
        listings.push('\n');
        let key = line.split(',').next().unwrap();
        codes.push_str(&format!("{key},{code}\n"));
    }
    let dir = api.csv.parent().unwrap();
    let (x, y) = (dir.join("x_train.csv"), dir.join("y_train.csv"));
    std::fs::write(&x, listings).unwrap();
    std::fs::write(&y, codes).unwrap();
    (x, y)
}

#[tokio::test(flavor = "multi_thread")]
async fn the_engine_joins_rakuten_s_two_files_before_it_walks_on() {
    let api = api().await;
    let (x, y) = rakuten_like_files(&api);
    rakuten_like_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&x, &y], "walk-rakuten-files")).await;
    // The look's run fails at the split, which finds no target in the listings; the methods
    // decide the split, and the join method reads both loads all the same. Identifiers are
    // dropped after the join, which uses the row index as its key. The target's shape is
    // measured once the codes are joined, so the task and the class balance are decided then.
    // Then the walk goes on as with one joined file, to the test rows' score.
    assert_eq!(
        trail(&detail),
        [
            "build",
            "measure",
            "run",
            "decide data.text_spelling keep",
            "decide data.repeated_items independent_rows",
            "decide split.method stratified_random",
            "measure",
            "run",
            "verify",
            "decide data.missing_markers keep",
            "decide data.type_repair keep",
            "decide data.join_sources join_on_key",
            "measure",
            "run",
            "verify",
            "decide data.html_text strip",
            "measure",
            "run",
            "verify",
            "decide data.column_roles drop_identifiers",
            "measure",
            "run",
            "verify",
            "decide data.exact_duplicates keep",
            "decide features.text_representation vectorize_words",
            "measure",
            "run",
            "decide features.date_parts no_dates",
            "decide features.rare_categories keep_categories",
            "decide cleaning.missingness_strategy no_gaps",
            "decide features.wide_categories keep",
            "decide features.encoding_strategy no_encoding",
            "decide features.skew_transform no_transform",
            "decide features.scaling_strategy no_scaling",
            "decide question.task_type classification",
            "verify",
            "decide question.error_costs not_two_classes",
            "decide evaluation.decision_threshold default_half",
            "decide question.class_balance balanced",
            "compare modeling.estimator_selection",
            "apply modeling.estimator_selection ml_linear_model",
            "run",
            "score",
            "stop",
        ],
        "{detail}"
    );
    assert_eq!(detail["walk"]["stop"]["reason"], "complete", "{detail}");
    // The codes are joined on the row index both files share, from the load no step read.
    let join = detail["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["decides"] == "data.join_sources")
        .unwrap();
    let effect = &join["effects"][0];
    assert_eq!(effect["operator"], "sprisk.io.join@1.0.0", "{join}");
    assert_eq!(effect["params"], json!({ "key": "unnamed_0" }), "{join}");
    assert!(
        effect["other"].as_str().unwrap().ends_with(".data"),
        "{join}"
    );
}

/// A small table a model can learn and a featureless baseline cannot: `dose` sets `outcome`,
/// `batch` is noise. No gaps, no text, no identifiers, so the walk reaches the model choice.
fn learnable_table() -> String {
    let mut csv = String::from("dose,batch,outcome\n");
    for i in 0..240u32 {
        let dose = f64::from(i % 60) / 4.0 + 0.5;
        let batch = f64::from((i * 7) % 11) + 0.25;
        let outcome = if dose > 7.5 { "responds" } else { "none" };
        csv.push_str(&format!("{dose},{batch},{outcome}\n"));
    }
    csv
}

/// The question a person states for the learnable table, with costs and a bar, so the walk
/// can compare models.
async fn learnable_question(api: &Api) {
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    q["objective"]["value"] = json!("Tell which doses get a response.");
    q["target"]["value"] = json!("outcome");
    q["interpretability"] = json!({ "value": "low", "origin": "explicit" });
    // A person states what each mistake costs and the bar in that metric before any score.
    q["costs"] = json!({ "value": { "positive": "responds", "false_negative": 1.0, "false_positive": 1.0 },
                         "origin": "explicit" });
    q["success_bar"] =
        json!({ "value": { "metric": "expected_cost", "score": 0.2 }, "origin": "explicit" });
    let facts = q.as_object_mut().unwrap();
    for gone in ["time_column", "entity_column", "prediction_horizon"] {
        facts.remove(gone);
    }
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

/// `from`'s files under `to`, without Python's caches.
fn copy_tree(from: &Path, to: &Path) {
    let files = walkdir::WalkDir::new(from)
        .into_iter()
        .filter_entry(|e| e.file_name() != "__pycache__");
    for entry in files {
        let entry = entry.unwrap();
        let target = to.join(entry.path().strip_prefix(from).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target).unwrap();
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

const SHUFFLE_METHOD: &str = r#"schema_version: sprisk.method/v2
id: methodology.supervised.shuffle_split@1.0.0
decides: split.method
name: Train/test split
activity: Fair evaluation
question: How are rows divided into training and test so the score is fair?
applies_when: { task: [classification, regression] }
needs:
  concepts: [common.target]
  evidence: []
  decisions: []
options:
  - id: shuffled
    label: Shuffled rows
    action:
      replace:
        role: split
        operator: sprisk.validation.shuffle_split@1.0.0
        settings: { test_fraction: 0.2, seed: 7 }
    verify: [no_row_in_both]
verifications:
  no_row_in_both:
    needs: evaluation.row_overlap
    promise: No test row has the same features as a train row.
source: "scikit-learn User Guide §3.1: ShuffleSplit."
"#;

const SHUFFLE_MODULE: &str = r#"from typing import Any


def decide(ctx: Any) -> Any:
    return ctx.choose("shuffled", "Rows are shuffled into train and test.")


def verify_no_row_in_both(evidence: dict[str, Any], settings: dict[str, Any]) -> tuple[str, str]:
    if evidence["in_both"]:
        return "fail", f"{evidence['in_both']} test rows repeat a train row."
    return "pass", "No test row repeats a train row."
"#;

/// ADR-0064 criterion 6: a split operator and a method added as folders only are used, with
/// no edit to `crates/` or the packs' Python.
#[tokio::test(flavor = "multi_thread")]
async fn a_split_operator_and_a_method_added_as_folders_are_used_with_no_code_edit() {
    let mut api = api().await;
    let packs = tempfile::tempdir().unwrap();
    let (plugins_root, methodology_root) = (
        packs.path().join("plugins"),
        packs.path().join("methodology"),
    );
    copy_tree(&root().join("plugins"), &plugins_root);
    copy_tree(&root().join("methodology"), &methodology_root);
    // A split with its own id and folds, on the core's trusted random split code.
    let split = std::fs::read_to_string(
        plugins_root.join("validation/operators/random_split/manifest.yaml"),
    )
    .unwrap()
    .replace(
        "sprisk.validation.random_split@1.0.0",
        "sprisk.validation.shuffle_split@1.0.0",
    )
    .replace("role_default: true\n", "")
    .replace("title: Random split", "title: Shuffle split");
    let folder = plugins_root.join("validation/operators/shuffle_split");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("manifest.yaml"), split).unwrap();
    // A method in the split method's place.
    let methods = methodology_root.join("supervised/methods");
    std::fs::remove_dir_all(methods.join("split_method")).unwrap();
    std::fs::create_dir_all(methods.join("shuffle_split")).unwrap();
    std::fs::write(methods.join("shuffle_split/method.yaml"), SHUFFLE_METHOD).unwrap();
    std::fs::write(methods.join("shuffle_split/method.py"), SHUFFLE_MODULE).unwrap();
    let plugins = Registry::load_dir(&plugins_root).unwrap();
    api.state.rules = Arc::new(
        sprisk_methodology::RuleCatalog::load_dir(&methodology_root, plugins.operators()).unwrap(),
    );
    api.state.registry = Arc::new(plugins);
    let python = api.state.worker_command[0].clone();
    api.state.worker_command = vec![
        python,
        "-m".into(),
        "sprisk_workers".into(),
        "--plugins-root".into(),
        plugins_root.display().to_string(),
        "--plugins-root".into(),
        methodology_root.display().to_string(),
    ];
    api.app = router(api.state.clone());
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-added-folders")).await;

    let steps = detail["steps"].as_array().unwrap();
    let split = steps
        .iter()
        .find(|s| s["decides"] == "split.method")
        .unwrap();
    assert_eq!(
        split["method"], "methodology.supervised.shuffle_split@1.0.0",
        "{split}"
    );
    // The comparison folds the new split by the folds its manifest declares.
    assert!(steps.iter().any(|s| s["action"] == "compare"), "{detail}");
    let checked = steps
        .iter()
        .filter(|s| s["action"] == "verify")
        .flat_map(|s| s["verifications"].as_array().unwrap())
        .any(|c| c["verification"] == "no_row_in_both" && c["result"] == "pass");
    assert!(checked, "{detail}");
    let head = detail["walk"]["head_pipeline_version_id"].as_str().unwrap();
    let (_, flow) = call(&api.app, "GET", &format!("/pipeline_versions/{head}"), None).await;
    let used = flow["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "split")
        .unwrap();
    assert_eq!(
        used["operator"], "sprisk.validation.shuffle_split@1.0.0",
        "{flow}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_complete_walk_ends_in_a_report_whose_claims_link_to_their_records() {
    let api = api().await;
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-reported")).await;
    assert_eq!(detail["walk"]["stop"]["reason"], "complete", "{detail}");
    let walk = detail["walk"]["id"].as_str().unwrap();
    let (status, report) = call(&api.app, "GET", &format!("/walks/{walk}/report"), None).await;
    assert_eq!(status, StatusCode::OK, "{report}");

    let (_, question) = call(
        &api.app,
        "GET",
        "/question_versions/qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        None,
    )
    .await;
    assert_eq!(
        report["question"], question["objective"]["value"],
        "{report}"
    );
    let steps = detail["steps"].as_array().unwrap();
    let scored = steps.iter().find(|s| s["action"] == "score").unwrap();
    let answer = &report["answer"];
    assert!(
        answer["statement"]
            .as_str()
            .unwrap()
            .contains("Test rows, scored once"),
        "{answer}"
    );
    assert!(
        answer["evidence"]
            .as_array()
            .unwrap()
            .contains(&json!({ "run": scored["run_id"] })),
        "{answer}"
    );
    let claims = report["claims"].as_array().unwrap();
    // Each decision in the trail is a claim citing its record, and each record resolves.
    for step in steps
        .iter()
        .filter(|s| s["action"] == "decide" || s["action"] == "apply")
    {
        let cited = json!({ "decision": step["methodology_decision_id"] });
        assert!(
            claims
                .iter()
                .any(|c| c["evidence"].as_array().unwrap().contains(&cited)),
            "{step} {report}"
        );
        let id = step["methodology_decision_id"].as_str().unwrap();
        let (status, _) = call(
            &api.app,
            "GET",
            &format!("/methodology_decisions/{id}"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{id}");
    }
    assert!(
        claims
            .iter()
            .all(|c| !c["evidence"].as_array().unwrap().is_empty()),
        "{report}"
    );
    assert!(
        !report["limitations"].as_array().unwrap().is_empty(),
        "{report}"
    );
    // The seal (ADR-0064): the split's promise is checked on features, and the class shares,
    // which read the test labels, come only with the score.
    let checked: Vec<&Value> = steps
        .iter()
        .filter(|s| s["action"] == "verify")
        .flat_map(|s| s["verifications"].as_array().unwrap())
        .collect();
    assert!(
        checked
            .iter()
            .any(|c| c["verification"] == "no_row_in_both"),
        "{detail}"
    );
    let mut placed = steps
        .iter()
        .filter_map(|s| s["effects"].as_array())
        .flatten()
        .map(|e| e["operator"].as_str().unwrap_or(""));
    assert!(placed.all(|o| !o.contains("class_shares")), "{detail}");
    assert!(
        claims
            .iter()
            .any(|c| c["statement"].as_str().unwrap().starts_with("Class shares")),
        "{report}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_walk_that_did_not_complete_has_no_report() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    rakuten_like_question(&api).await;
    let mut request = walk_request(&[&api.csv], "walk-unreported");
    request["max_actions"] = json!(1);
    let detail = walk_to_end(&api, request).await;
    assert_ne!(detail["walk"]["stop"]["reason"], "complete", "{detail}");
    let walk = detail["walk"]["id"].as_str().unwrap();

    let (status, body) = call(&api.app, "GET", &format!("/walks/{walk}/report"), None).await;

    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_complete_walk_scores_its_test_rows_once_and_ends_on_that_score() {
    let api = api().await;
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-scored")).await;

    let trail = trail(&detail);
    assert_eq!(detail["walk"]["stop"]["reason"], "complete", "{detail}");
    assert_eq!(
        trail.iter().filter(|s| *s == "score").count(),
        1,
        "{detail}"
    );
    assert_eq!(&trail[trail.len() - 2..], ["score", "stop"], "{detail}");
    let why = detail["walk"]["stop"]["detail"].as_str().unwrap();
    assert!(why.contains("Test rows, scored once"), "{why}");
    assert!(why.contains("the success bar of 0.2"), "{why}");
    assert!(why.contains("expected cost"), "{why}");
    // The floor on the same rows: what the score is worth.
    let floor = why
        .split("the baseline on the same rows: ")
        .nth(1)
        .unwrap_or("");
    assert!(floor.contains("expected cost 0."), "{why}");
    let head = detail["walk"]["head_pipeline_version_id"].as_str().unwrap();
    let (_, flow) = call(&api.app, "GET", &format!("/pipeline_versions/{head}"), None).await;
    assert!(
        flow["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "score_test"),
        "{flow}"
    );
    // The scored flow is sealed: changing or comparing it would choose by the test rows.
    let uri = format!("/pipeline_versions/{head}/methodology/proposals/model");
    let (status, body) = call(&api.app, "POST", &uri, Some(json!({}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["errors"][0]["code"], "test_rows_scored", "{body}");
    let uri = format!("/pipeline_versions/{head}/model_selection/model");
    let (status, body) = call(&api.app, "POST", &uri, Some(json!({}))).await;
    assert_eq!(
        body["errors"][0]["code"], "test_rows_scored",
        "{status} {body}"
    );
}

/// A method session whose checks of `verification` all end as `result`: the stand-in for a
/// split that broke its promise, or one its evidence cannot settle.
fn checks_end_as(api: &mut Api, verification: &str, result: &str) {
    let stub = format!(
        "import sprisk_workers.method as m\n\
        real = m.verify\n\
        def verify(request):\n\
        \x20   found = real(request).model_dump_json()\n\
        \x20   if request.model_dump(mode='json')['verification'] == '{verification}':\n\
        \x20       found = found.replace('\"pass\"', '\"{result}\"')\n\
        \x20   return m.MethodAnswer.model_validate_json(found)\n\
        m.verify = verify\n\
        m.main()\n"
    );
    api.state.method_runner = sprisk_api::MethodRunner::new(
        vec![
            root().join(".venv/bin/python").display().to_string(),
            "-c".into(),
            stub,
        ],
        Duration::from_secs(30),
        2,
    );
    api.app = router(api.state.clone());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_promise_its_evidence_cannot_settle_keeps_the_test_rows_sealed() {
    let mut api = api().await;
    checks_end_as(&mut api, "no_row_in_both", "inconclusive");
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-unverified")).await;

    let trail = trail(&detail);
    assert_eq!(detail["walk"]["stop"]["reason"], "unverified", "{detail}");
    assert!(!trail.contains(&"score".to_owned()), "{detail}");
    let why = detail["walk"]["stop"]["detail"].as_str().unwrap();
    assert!(
        why.contains("The test rows stay sealed until every promise passes."),
        "{why}"
    );
    assert!(why.contains("no_row_in_both"), "{why}");
}

/// The split's promise fails: the walk decides the split again, without the option that
/// broke it. A random split cannot keep repeated rows apart, so the method asks for the item
/// column, and the test rows stay sealed.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_promise_reopens_the_decision_that_made_it() {
    let mut api = api().await;
    checks_end_as(&mut api, "no_row_in_both", "fail");
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-reopened")).await;

    let trail = trail(&detail);
    assert!(!trail.contains(&"score".to_owned()), "{detail}");
    let steps = detail["steps"].as_array().unwrap();
    let failed = steps
        .iter()
        .position(|s| {
            s["verifications"]
                .to_string()
                .contains(r#""result":"fail""#)
        })
        .unwrap_or_else(|| panic!("the split's promise is checked: {detail}"));
    assert!(
        trail[..failed].contains(&"decide split.method stratified_random".to_owned()),
        "{detail}"
    );
    assert_eq!(detail["walk"]["stop"]["reason"], "needs_person", "{detail}");
    let asks = detail["walk"]["stop"]["asks"].as_array().unwrap();
    let split = asks
        .iter()
        .find(|a| a["decides"] == "split.method")
        .unwrap_or_else(|| panic!("the split is asked again: {detail}"));
    let question = split["question"].as_str().unwrap();
    assert!(question.contains("broke its promise"), "{question}");
    let offered: Vec<&str> = split["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap())
        .collect();
    assert!(!offered.contains(&"stratified_random"), "{split}");
}

/// A person answered the split with a random split; its promise fails on these rows, so the
/// answer is not applied again: the method is asked once more, without that option.
#[tokio::test(flavor = "multi_thread")]
async fn an_answer_whose_promise_failed_is_not_applied_again() {
    let mut api = api().await;
    checks_end_as(&mut api, "no_row_in_both", "fail");
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;
    let (_, mut q) = call(
        &api.app,
        "GET",
        "/question_versions/qv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        None,
    )
    .await;
    q["id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ1");
    q["parent_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    q["answers"] = json!([{ "decides": "split.method", "option": "simple_random" }]);
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut request = walk_request(&[&api.csv], "walk-answer-failed");
    request["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ1");

    let detail = walk_to_end(&api, request).await;

    let answered = trail(&detail)
        .iter()
        .filter(|s| *s == "decide split.method simple_random")
        .count();
    assert_eq!(answered, 1, "{detail}");
    assert_eq!(detail["walk"]["stop"]["reason"], "needs_person", "{detail}");
    assert_eq!(
        detail["walk"]["stop"]["asks"][0]["decides"], "split.method",
        "{detail}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_method_that_refuses_to_check_its_promise_stops_the_walk_with_an_error() {
    let mut api = api().await;
    let refusing = "import sprisk_workers.method as m\n\
        m.verify = lambda request: m.MethodAnswer.model_validate_json(\n\
        \x20   '{\"answer\": \"refused\", \"error\": \"no verify here\"}')\n\
        m.main()\n";
    api.state.method_runner = sprisk_api::MethodRunner::new(
        vec![
            root().join(".venv/bin/python").display().to_string(),
            "-c".into(),
            refusing.into(),
        ],
        Duration::from_secs(30),
        2,
    );
    api.app = router(api.state.clone());
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-refused-check")).await;

    assert_eq!(detail["walk"]["stop"]["reason"], "error", "{detail}");
    let why = detail["walk"]["stop"]["detail"].as_str().unwrap();
    assert!(why.contains("refused its request"), "{why}");
    assert!(!trail(&detail).contains(&"score".to_owned()), "{detail}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_second_walk_on_the_same_files_never_scores_their_test_rows_again() {
    let api = api().await;
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;
    let first = walk_to_end(&api, walk_request(&[&api.csv], "walk-scored")).await;
    assert_eq!(first["walk"]["stop"]["reason"], "complete", "{first}");

    // The same rows, from a copy at another path: a second score would be a second look.
    let copy = api.csv.with_file_name("copy.csv");
    std::fs::copy(&api.csv, &copy).unwrap();
    let second = walk_to_end(&api, walk_request(&[&copy], "walk-again")).await;

    let trail = trail(&second);
    assert!(!trail.iter().any(|s| s == "score"), "{second}");
    assert_eq!(second["walk"]["stop"]["reason"], "limitation", "{second}");
    let why = second["walk"]["stop"]["detail"].as_str().unwrap();
    assert!(why.contains(first["walk"]["id"].as_str().unwrap()), "{why}");
    assert!(why.contains("Test rows, scored once"), "{why}");
    // Nothing of the refused scoring is kept: the head is the flow the rules settled.
    let head = second["walk"]["head_pipeline_version_id"].as_str().unwrap();
    let (_, flow) = call(&api.app, "GET", &format!("/pipeline_versions/{head}"), None).await;
    assert!(
        !flow["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "score_test"),
        "{flow}"
    );
}

/// The learnable table with gaps in `batch` on every seventh row: a model refuses gaps. Rows
/// 60 apart share a dose, and never both lose their batch, so no row copies another.
fn gappy_table() -> String {
    learnable_table()
        .lines()
        .enumerate()
        .map(|(line, text)| {
            const BATCH: usize = 1; // dose,batch,outcome
            let mut cells: Vec<&str> = text.split(',').collect();
            if line > 0 && (line - 1) % 7 == 3 {
                cells[BATCH] = "";
            }
            cells.join(",") + "\n"
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn the_engine_fills_gaps_before_the_model_and_walks_on_to_the_comparison() {
    let api = api().await;
    std::fs::write(&api.csv, gappy_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-gappy")).await;
    let trail = trail(&detail);
    let filled = trail
        .iter()
        .position(|s| s == "decide cleaning.missingness_strategy fill_before_model")
        .unwrap_or_else(|| panic!("the gaps are filled: {detail}"));
    let compared = trail
        .iter()
        .position(|s| s == "compare modeling.estimator_selection")
        .unwrap_or_else(|| panic!("the filled flow runs, so the shortlist is compared: {detail}"));
    assert!(filled < compared, "{detail}");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_engine_compares_the_model_shortlist_on_fixed_folds_and_applies_the_winner() {
    let api = api().await;
    std::fs::write(&api.csv, learnable_table()).unwrap();
    learnable_question(&api).await;

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-learnable")).await;
    let trail = trail(&detail);
    let compared = trail
        .iter()
        .position(|s| s == "compare modeling.estimator_selection")
        .unwrap_or_else(|| panic!("the shortlist is compared: {detail}"));
    assert!(
        trail[compared + 1].starts_with("apply modeling.estimator_selection ml_"),
        "then its winner is applied: {detail}"
    );
    let steps = detail["steps"].as_array().unwrap();
    assert!(
        steps[compared]["run_id"].is_string(),
        "the comparison's run: {detail}"
    );
    let head = detail["walk"]["head_pipeline_version_id"].as_str().unwrap();
    let (_, flow) = call(&api.app, "GET", &format!("/pipeline_versions/{head}"), None).await;
    let model = flow["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "model")
        .unwrap();
    assert_ne!(
        model["operator"], "sprisk.ml.dummy_baseline@3.0.0",
        "a model that beats the baseline: {flow}"
    );
    assert_eq!(
        model["params"]["costs"]["positive"], "responds",
        "compared by the costs the person stated: {flow}"
    );
}

/// The same question on rows where `outcome` does not depend on anything a model sees.
#[tokio::test(flavor = "multi_thread")]
async fn a_walk_where_no_model_beats_the_baseline_stops_and_says_so() {
    let api = api().await;
    // Three independent seeded streams: what a model sees tells nothing about the outcome.
    let mut streams = [11u64, 23, 37];
    let mut draw = |at: usize| {
        streams[at] = streams[at]
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        streams[at] >> 33
    };
    let mut csv = String::from("dose,batch,outcome\n");
    for _ in 0..240 {
        let dose = (draw(0) % 1000) as f64 / 37.0 + 0.01;
        let batch = (draw(1) % 1000) as f64 / 53.0 + 0.01;
        let outcome = if draw(2) % 2 == 0 { "responds" } else { "none" };
        csv.push_str(&format!("{dose},{batch},{outcome}\n"));
    }
    std::fs::write(&api.csv, csv).unwrap();
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    q["target"]["value"] = json!("outcome");
    q["interpretability"] = json!({ "value": "low", "origin": "explicit" });
    q["costs"] = json!({ "value": { "positive": "responds", "false_negative": 1.0, "false_positive": 1.0 },
                         "origin": "explicit" });
    q["success_bar"] =
        json!({ "value": { "metric": "expected_cost", "score": 0.2 }, "origin": "explicit" });
    let facts = q.as_object_mut().unwrap();
    for gone in ["time_column", "entity_column", "prediction_horizon"] {
        facts.remove(gone);
    }
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let detail = walk_to_end(&api, walk_request(&[&api.csv], "walk-noise")).await;
    let trail = trail(&detail);
    assert_eq!(trail.last().map(String::as_str), Some("stop"), "{detail}");
    assert!(
        !trail
            .iter()
            .any(|t| t.starts_with("apply modeling.estimator_selection")),
        "no model is chosen: {detail}"
    );
    assert_eq!(detail["walk"]["stop"]["reason"], "limitation", "{detail}");
}

/// The same flow runs: the forest reads every column but the target and the key columns, so
/// the text unit column order_id and the time column never reach it.
#[tokio::test(flavor = "multi_thread")]
async fn a_model_reading_every_column_leaves_out_the_key_columns_when_it_runs() {
    let api = api().await;
    let q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    flow["nodes"].as_array_mut().unwrap().extend([
        json!({ "id":"split", "operator":"sprisk.validation.temporal_split@1.0.0",
                "params":{"time_column":"order_date","group_column":"order_id","test_fraction":0.25} }),
        json!({ "id":"model", "operator":"sprisk.ml.random_forest@3.0.0",
                "params":{"target":"returned_within_30d","task":"classification","n_estimators":10} }),
    ]);
    flow["edges"] = json!([
        {"from":"load.data","to":"split.data"},
        {"from":"split.train","to":"model.train"}
    ]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut csv = String::from("order_id,order_date,age,returned_within_30d\n");
    for i in 0..60 {
        csv.push_str(&format!(
            "o{},{i},{},{}\n",
            i / 12,
            20 + i,
            u8::from(i % 2 == 0)
        ));
    }
    std::fs::write(&api.csv, csv).unwrap();
    let (run, attempts) = run_version(&api, BASE).await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");
}

/// Rakuten-shaped listings, by hand: Vectorize text turns the title and description into
/// words, the model fits beside the table, Evaluate and importance read the test words, and
/// a comparison refits the words in every fold (ADR-0058).
#[tokio::test(flavor = "multi_thread")]
async fn word_features_run_from_load_to_evaluate_and_are_refit_in_each_fold() {
    let api = api().await;
    std::fs::write(&api.csv, rakuten_like_listings()).unwrap();
    let mut q = question("qv_01JABCDEFGHJKMNPQRSTVWXYZ0", None);
    q["target"]["value"] = json!("prdtypecode");
    let facts = q.as_object_mut().unwrap();
    for fact in ["time_column", "entity_column", "prediction_horizon"] {
        facts.remove(fact);
    }
    facts.insert(
        "success_bar".into(),
        json!({ "value": { "metric": "weighted_f1", "score": 0.5 }, "origin": "explicit" }),
    );
    let (status, body) = call(&api.app, "POST", "/question_versions", Some(q)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let target = json!({"target": "prdtypecode", "task": "classification"});
    let ids = json!(["unnamed_0", "productid", "imageid"]);
    let mut flow = pipeline(&api.csv);
    flow["question_version_id"] = json!("qv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    flow["nodes"].as_array_mut().unwrap().extend([
        json!({"id": "split", "operator": "sprisk.validation.random_split@1.0.0",
               "params": {"test_fraction": 0.25, "seed": 42, "stratify": "prdtypecode"}}),
        json!({"id": "words", "operator": "sprisk.clean.vectorize_text@1.1.0",
               "params": {"columns": ["designation", "description"]}}),
        json!({"id": "model", "operator": "sprisk.ml.linear_model@3.0.0",
               "params": {"target": "prdtypecode", "task": "classification", "exclude": ids}}),
        json!({"id": "score", "operator": "sprisk.ml.evaluate@2.1.0", "params": target}),
        json!({"id": "matters", "operator": "sprisk.ml.feature_importance@2.0.0",
               "params": {"target": "prdtypecode"}}),
    ]);
    flow["edges"] = json!([
        {"from": "load.data", "to": "split.data"},
        {"from": "split.train", "to": "words.train"},
        {"from": "split.test", "to": "words.test"},
        {"from": "words.train", "to": "model.train"},
        {"from": "words.train_words", "to": "model.words"},
        {"from": "model.model", "to": "score.model"},
        {"from": "words.test", "to": "score.test"},
        {"from": "words.test_words", "to": "score.words"},
        {"from": "model.model", "to": "matters.model"},
        {"from": "words.test", "to": "matters.test"},
        {"from": "words.test_words", "to": "matters.words"},
    ]);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(flow)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (run, attempts) = run_to_end(&api).await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");
    let metrics = output(&api, &attempts, "score", "metrics").await;
    assert!(metrics["weighted_f1"].as_f64().unwrap() > 0.9, "{metrics}");

    let (status, selection) = select_model(&api, "model").await;
    assert_eq!(status, StatusCode::CREATED, "{selection}");
    let (run, attempts) = wait_run(&api, selection["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");
    let decision = output(&api, &attempts, "select_model", "decision").await;
    assert!(decision["winner"].is_string(), "{decision}");
    assert_ne!(decision["winner"], "ml_dummy_baseline", "{decision}");

    // Scored as a walk scores it: the baseline beside the model, with the same words. Its table
    // holds only the target and left-out ids, so without the words it could not be scored.
    let base_id: sprisk_contracts::PipelineVersionId =
        parse("\"plv_01JABCDEFGHJKMNPQRSTVWXYZ0\"").unwrap();
    let base = api.store.get_pipeline_version(&base_id).await.unwrap();
    let (nodes, edges) =
        sprisk_methodology::engine::with_test_scoring(&base, &defaults(&api.state)).unwrap();
    let mut scored = serde_json::to_value(&base).unwrap();
    scored["id"] = json!("plv_01JABCDEFGHJKMNPQRSTVWXYZ5");
    scored["parent_id"] = json!(base_id);
    scored["nodes"] = json!(nodes);
    scored["edges"] = json!(edges);
    let (status, body) = call(&api.app, "POST", "/pipeline_versions", Some(scored)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (run, attempts) = run_version(&api, "plv_01JABCDEFGHJKMNPQRSTVWXYZ5").await;
    assert_eq!(run["status"], "succeeded", "{run} {attempts}");
    let model = output(&api, &attempts, "score_test", "metrics").await;
    let floor = output(&api, &attempts, "score_baseline", "metrics").await;
    assert!(
        floor["weighted_f1"].as_f64().unwrap() < model["weighted_f1"].as_f64().unwrap(),
        "{floor} {model}"
    );
}
