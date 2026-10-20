#![allow(clippy::unwrap_used, clippy::expect_used)]

//! M1 exit (arch §16): two independent datasets run end to end through the API, the
//! scheduler and the real Python worker. Plus §15.3: a worker killed mid-run.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use sprisk_cli::{Client, ServeConfig, pipeline_from_yaml, serve_on};
use sprisk_contracts::{AttemptState, RunStatus};

const NOW: &str = "2026-10-16T10:00:00Z";
/// Every step, plus the control plane's checks: Gate B and the split's rows (ADR-0040).
const NODES: [&str; 10] = [
    "baseline",
    "distributions",
    "gate_b",
    "gate_split",
    "load",
    "model",
    "profile",
    "score_baseline",
    "score_model",
    "split",
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Start an API on a free port. `python` replaces the worker interpreter.
async fn server(data: &Path, python: Option<PathBuf>) -> Client {
    let root = root();
    let mut config = ServeConfig::for_repo(&root, data, &root.join("tests/fixtures/datasets"));
    if let Some(python) = python {
        config.python = python;
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(serve_on(listener, config));
    Client::new(&base)
}

fn pipeline(name: &str) -> sprisk_contracts::PipelineVersion {
    let root = root();
    let datasets = root.join("tests/fixtures/datasets").canonicalize().unwrap();
    let yaml = std::fs::read_to_string(root.join(format!("tests/fixtures/pipelines/{name}.yaml")))
        .unwrap()
        .replace("$DATASETS", &datasets.display().to_string());
    pipeline_from_yaml(&yaml, NOW).unwrap()
}

/// The `metrics` JSON of one scoring node's succeeded attempt.
async fn metrics(client: &Client, run: &sprisk_contracts::RunId, node: &str) -> Value {
    let attempts = client.attempts(run).await.unwrap();
    let attempt = attempts
        .iter()
        .find(|a| a.node_id.as_str() == node && a.state == AttemptState::Succeeded)
        .unwrap();
    let outputs = client.outputs(&attempt.id).await.unwrap();
    let metrics = outputs
        .iter()
        .find(|o| o.port.as_str() == "metrics")
        .unwrap();
    serde_json::from_str(&client.content(&metrics.artifact.id).await.unwrap()).unwrap()
}

async fn run_to_end(client: &Client, name: &str) -> sprisk_contracts::Run {
    let run = client.submit_and_start(&pipeline(name)).await.unwrap();
    client
        .wait(&run.id, Duration::from_secs(120))
        .await
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn iris_classification_model_beats_the_baseline() {
    let data = tempfile::tempdir().unwrap();
    let client = server(data.path(), None).await;

    let run = run_to_end(&client, "iris").await;

    assert_eq!(
        run.status,
        RunStatus::Succeeded,
        "{}",
        client.report(&run.id).await.unwrap()
    );
    let baseline = metrics(&client, &run.id, "score_baseline").await;
    let model = metrics(&client, &run.id, "score_model").await;
    assert!(baseline["balanced_accuracy"].as_f64().unwrap() < 0.5);
    assert!(
        model["balanced_accuracy"].as_f64().unwrap() > 0.85,
        "{model}"
    );
    assert_eq!(model["n_rows"], 38, "25% of 150 rows held out");
}

#[tokio::test(flavor = "multi_thread")]
async fn penguins_species_forest_beats_the_baseline() {
    let data = tempfile::tempdir().unwrap();
    let client = server(data.path(), None).await;

    let run = run_to_end(&client, "penguins").await;

    assert_eq!(
        run.status,
        RunStatus::Succeeded,
        "{}",
        client.report(&run.id).await.unwrap()
    );
    let baseline = metrics(&client, &run.id, "score_baseline").await;
    let forest = metrics(&client, &run.id, "score_forest").await;
    assert!(baseline["balanced_accuracy"].as_f64().unwrap() < 0.5);
    assert!(
        forest["balanced_accuracy"].as_f64().unwrap() > 0.9,
        "{forest}"
    );
    assert_eq!(forest["n_rows"], 86, "25% of 344 rows held out");
    assert_eq!(forest["confusion"]["labels"].as_array().unwrap().len(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn diabetes_regression_model_beats_the_baseline() {
    let data = tempfile::tempdir().unwrap();
    let client = server(data.path(), None).await;

    let run = run_to_end(&client, "diabetes").await;

    assert_eq!(
        run.status,
        RunStatus::Succeeded,
        "{}",
        client.report(&run.id).await.unwrap()
    );
    let baseline = metrics(&client, &run.id, "score_baseline").await;
    let model = metrics(&client, &run.id, "score_model").await;
    assert!(model["rmse"].as_f64().unwrap() < baseline["rmse"].as_f64().unwrap());
    assert!(model["r2"].as_f64().unwrap() > 0.3, "{model}");

    // Run history: every node succeeded once, in a recorded attempt.
    let attempts = client.attempts(&run.id).await.unwrap();
    let mut nodes: Vec<_> = attempts.iter().map(|a| a.node_id.as_str()).collect();
    nodes.sort();
    assert_eq!(nodes, NODES);
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn worker_killed_mid_run_is_replaced_and_nothing_false_is_committed() {
    let data = tempfile::tempdir().unwrap();
    // A wrapper records each worker's pid, so the test can kill the live one.
    let pids = data.path().join("pids");
    let wrapper = data.path().join("python");
    // Not canonicalized: the venv's python is a symlink, and resolving it leaves the venv.
    let python = root().join(".venv/bin/python");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho $$ >> {}\nexec {} \"$@\"\n",
            pids.display(),
            python.display()
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let client = server(data.path(), Some(wrapper)).await;

    let run = client.submit_and_start(&pipeline("iris")).await.unwrap();
    // Kill the workers while a pipeline step (not the gate) is running. Steps are fast with a
    // warm worker (ADR-0026), so a kill can land between steps; then try the next step.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    loop {
        if tokio::time::Instant::now() >= deadline {
            panic!(
                "no step was lost:\n{}",
                client.report(&run.id).await.unwrap()
            );
        }
        let attempts = client.attempts(&run.id).await.unwrap();
        if attempts.iter().any(|a| {
            a.error
                .as_ref()
                .is_some_and(|e| e.code.as_str() == "worker_lost")
        }) {
            break;
        }
        let busy = attempts.iter().any(|a| {
            a.node_id.as_str() != "gate_b"
                && matches!(a.state, AttemptState::Running | AttemptState::Leased)
        });
        if busy {
            // Every worker started so far: the busy one, and possibly an idle warm one.
            for pid in std::fs::read_to_string(&pids).unwrap().lines() {
                let _ = std::process::Command::new("kill")
                    .args(["-9", pid])
                    .status();
            }
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let run = client
        .wait(&run.id, Duration::from_secs(120))
        .await
        .unwrap();

    assert_eq!(
        run.status,
        RunStatus::Succeeded,
        "{}",
        client.report(&run.id).await.unwrap()
    );
    let attempts = client.attempts(&run.id).await.unwrap();
    let lost: Vec<_> = attempts
        .iter()
        .filter(|a| {
            a.error
                .as_ref()
                .is_some_and(|e| e.code.as_str() == "worker_lost")
        })
        .collect();
    assert!(
        !lost.is_empty(),
        "{}",
        client.report(&run.id).await.unwrap()
    );
    assert!(lost.iter().all(|a| a.state == AttemptState::Failed));
    // No falsely committed artifact: only succeeded attempts have outputs.
    for a in &attempts {
        let outputs = client.outputs(&a.id).await.unwrap();
        assert_eq!(
            !outputs.is_empty(),
            a.state == AttemptState::Succeeded,
            "{} #{} {}",
            a.node_id.as_str(),
            a.number,
            a.state
        );
    }
    let succeeded: Vec<_> = attempts
        .iter()
        .filter(|a| a.state == AttemptState::Succeeded)
        .map(|a| a.node_id.as_str())
        .collect();
    assert_eq!(
        succeeded.len(),
        NODES.len(),
        "each node succeeded exactly once"
    );
    assert!(
        std::fs::read_to_string(&pids).unwrap().lines().count() >= 2,
        "a new worker started"
    );
}

/// The display a code step recorded: what it printed, showed and drew.
async fn display(client: &Client, run: &sprisk_contracts::RunId, node: &str) -> Vec<Value> {
    let attempts = client.attempts(run).await.unwrap();
    let attempt = attempts
        .iter()
        .find(|a| a.node_id.as_str() == node && a.state == AttemptState::Succeeded)
        .unwrap_or_else(|| panic!("{node} did not succeed"));
    let outputs = client.outputs(&attempt.id).await.unwrap();
    let shown = outputs
        .iter()
        .find(|o| o.port.as_str() == "display")
        .unwrap();
    let doc: Value =
        serde_json::from_str(&client.content(&shown.artifact.id).await.unwrap()).unwrap();
    doc["items"].as_array().unwrap().clone()
}

fn figures(items: &[Value]) -> usize {
    items.iter().filter(|i| i["kind"] == "figure").count()
}

/// The example methodology: split first, explore and select on training rows only, score the
/// holdout once. Every analysis step draws what it found.
#[tokio::test(flavor = "multi_thread")]
async fn diabetes_methodology_selects_by_cross_validation_and_draws_each_step() {
    let data = tempfile::tempdir().unwrap();
    let client = server(data.path(), None).await;

    let run = run_to_end(&client, "diabetes_methodology").await;

    assert_eq!(
        run.status,
        RunStatus::Succeeded,
        "{}",
        client.report(&run.id).await.unwrap()
    );
    for (node, drawn) in [
        ("explore", 4),
        ("compare_models", 3),
        ("final_model", 2),
        ("diagnostics", 4),
    ] {
        let items = display(&client, &run.id, node).await;
        assert_eq!(figures(&items), drawn, "{node}: {items:?}");
    }
    let printed: Vec<String> = display(&client, &run.id, "final_model")
        .await
        .iter()
        .filter_map(|i| i["text"].as_str().map(str::to_owned))
        .collect();
    assert!(
        printed
            .iter()
            .any(|t| t.contains("Selected by cross-validation")),
        "{printed:?}"
    );
    let baseline = metrics(&client, &run.id, "score_baseline").await;
    assert!(baseline["rmse"].as_f64().unwrap() > 60.0, "{baseline}");
}
