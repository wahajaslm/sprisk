#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;

use serde_json::{Value, json};
use sprisk_contracts::PipelineVersion;
use sprisk_graph::{CompileError, compile};
use sprisk_registry::Registry;

fn operator(id: &str, inputs: &[(&str, &str)], outputs: &[(&str, &str)], params: Value) -> Value {
    let ports = |ps: &[(&str, &str)]| -> Vec<Value> {
        ps.iter()
            .map(|(n, k)| json!({ "name": n, "kind": k }))
            .collect()
    };
    json!({
        "schema_version": "sprisk.operator/v1",
        "id": id,
        "capability_class": "transform",
        "entrypoint": "ops:run",
        "inputs": ports(inputs),
        "outputs": ports(outputs),
        "params_schema": params,
        "effects": "pure",
        "network": "none",
        "resources": { "cpu_cores": 1, "memory_mb": 64, "gpu": "none", "timeout_seconds": 60 }
    })
}

fn registry() -> (tempfile::TempDir, Registry) {
    let ops = [
        operator(
            "sprisk.source.parquet@1.0.0",
            &[],
            &[("data", "table")],
            json!({
                "type": "object",
                "required": ["dataset_version"],
                "properties": { "dataset_version": { "type": "string" } },
                "additionalProperties": false
            }),
        ),
        operator(
            "sprisk.validation.split@1.0.0",
            &[("data", "table")],
            &[("train", "table"), ("validation", "table")],
            json!({ "type": "object" }),
        ),
        operator(
            "sprisk.ml.train@1.0.0",
            &[("training_data", "table")],
            &[("model", "model")],
            json!({ "type": "object" }),
        ),
        operator(
            "sprisk.eval.evaluate@1.0.0",
            &[("model", "model"), ("validation_data", "table")],
            &[("metrics", "metrics")],
            json!({ "type": "object" }),
        ),
    ];
    let dir = tempfile::tempdir().unwrap();
    for (i, op) in ops.iter().enumerate() {
        let path = dir.path().join(format!("op{i}/manifest.yaml"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, op.to_string()).unwrap(); // JSON is valid YAML
    }
    let registry = Registry::load_dir(dir.path()).unwrap();
    (dir, registry)
}

fn pipeline(nodes: Value, edges: Value) -> PipelineVersion {
    let json = json!({
        "schema_version": "sprisk.pipeline_version/v1",
        "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "nodes": nodes,
        "edges": edges,
        "created_at": "2026-10-15T10:00:00Z"
    });
    sprisk_contracts::parse(&json.to_string()).unwrap()
}

fn node(id: &str, op: &str) -> Value {
    let params = if op.starts_with("sprisk.source") {
        json!({ "dataset_version": "dv_1" })
    } else {
        json!({})
    };
    json!({ "id": id, "operator": op, "params": params })
}

fn edge(from: &str, to: &str) -> Value {
    json!({ "from": from, "to": to })
}

fn valid_nodes() -> Value {
    json!([
        node("evaluate", "sprisk.eval.evaluate@1.0.0"),
        node("train", "sprisk.ml.train@1.0.0"),
        node("split", "sprisk.validation.split@1.0.0"),
        node("ingest", "sprisk.source.parquet@1.0.0"),
    ])
}

fn valid_edges() -> Value {
    json!([
        edge("ingest.data", "split.data"),
        edge("split.train", "train.training_data"),
        edge("train.model", "evaluate.model"),
        edge("split.validation", "evaluate.validation_data"),
    ])
}

fn errors(nodes: Value, edges: Value) -> Vec<CompileError> {
    let (_dir, registry) = registry();
    compile(&pipeline(nodes, edges), &registry).unwrap_err()
}

#[test]
fn valid_pipeline_compiles_to_steps_in_dependency_order() {
    let (_dir, registry) = registry();

    let plan = compile(&pipeline(valid_nodes(), valid_edges()), &registry).unwrap();

    let order: Vec<&str> = plan.steps.iter().map(|s| s.node_id.as_str()).collect();
    assert_eq!(order, ["ingest", "split", "train", "evaluate"]);
    let evaluate = &plan.steps[3];
    assert_eq!(evaluate.operator.id.as_str(), "sprisk.eval.evaluate@1.0.0");
    let inputs: Vec<(&str, &str, &str)> = evaluate
        .inputs
        .iter()
        .map(|i| (i.port.as_str(), i.from_node.as_str(), i.from_port.as_str()))
        .collect();
    assert_eq!(
        inputs,
        [
            ("model", "train", "model"),
            ("validation_data", "split", "validation")
        ]
    );
}

#[test]
fn empty_pipeline_is_rejected() {
    assert_eq!(errors(json!([]), json!([])), [CompileError::Empty]);
}

#[test]
fn duplicate_node_id_is_rejected() {
    let nodes = json!([
        node("ingest", "sprisk.source.parquet@1.0.0"),
        node("ingest", "sprisk.source.parquet@1.0.0"),
    ]);
    assert_eq!(
        errors(nodes, json!([])),
        [CompileError::DuplicateNode("ingest".into())]
    );
}

#[test]
fn unknown_operator_version_is_rejected() {
    let nodes = json!([node("ingest", "sprisk.source.parquet@2.0.0")]);
    assert_eq!(
        errors(nodes, json!([])),
        [CompileError::UnknownOperator {
            node: "ingest".into(),
            operator: "sprisk.source.parquet@2.0.0".into()
        }]
    );
}

#[test]
fn invalid_params_are_rejected_with_the_reason() {
    let nodes = json!([{ "id": "ingest", "operator": "sprisk.source.parquet@1.0.0", "params": { "dataset": 1 } }]);
    let errs = errors(nodes, json!([]));
    // Missing `dataset_version` and unexpected `dataset`: both reported.
    assert_eq!(errs.len(), 2, "{errs:?}");
    assert!(
        errs.iter()
            .all(|e| matches!(e, CompileError::InvalidParams { node, .. } if node == "ingest")),
        "{errs:?}"
    );
}

#[test]
fn edge_endpoints_must_be_real_ports() {
    let mut edges = valid_edges();
    edges.as_array_mut().unwrap().extend([
        edge("ghost.data", "split.data"),
        edge("split.data", "train.training_data"),
        edge("split.train", "train.nope"),
    ]);
    let errs = errors(valid_nodes(), edges);
    assert!(
        errs.contains(&CompileError::UnknownNode("ghost".into())),
        "{errs:?}"
    );
    assert!(
        errs.contains(&CompileError::NotAnOutput("split.data".into())),
        "{errs:?}"
    );
    assert!(
        errs.contains(&CompileError::NotAnInput("train.nope".into())),
        "{errs:?}"
    );
}

#[test]
fn port_kinds_must_match() {
    let mut edges = valid_edges();
    edges.as_array_mut().unwrap()[3] = edge("train.model", "evaluate.validation_data");
    let errs = errors(valid_nodes(), edges);
    assert!(
        errs.contains(&CompileError::KindMismatch {
            from: "train.model".into(),
            to: "evaluate.validation_data".into(),
            from_kind: "model".into(),
            to_kind: "table".into(),
        }),
        "{errs:?}"
    );
}

#[test]
fn every_input_is_connected_exactly_once() {
    let mut edges = valid_edges();
    let list = edges.as_array_mut().unwrap();
    list.remove(3); // evaluate.validation_data now unconnected
    list.push(edge("split.validation", "train.training_data")); // connected twice
    let errs = errors(valid_nodes(), edges);
    assert!(
        errs.contains(&CompileError::Unconnected(
            "evaluate.validation_data".into()
        )),
        "{errs:?}"
    );
    assert!(
        errs.contains(&CompileError::ConnectedTwice("train.training_data".into())),
        "{errs:?}"
    );
}

#[test]
fn cycles_are_rejected() {
    let nodes = json!([
        node("a", "sprisk.validation.split@1.0.0"),
        node("b", "sprisk.validation.split@1.0.0"),
    ]);
    let edges = json!([edge("a.train", "b.data"), edge("b.train", "a.data")]);
    let errs = errors(nodes, edges);
    assert!(
        matches!(errs.as_slice(), [CompileError::Cycle(_)]),
        "{errs:?}"
    );
}

#[test]
fn unknown_operator_is_reported_once_not_as_broken_edges() {
    let nodes = json!([
        node("ingest", "sprisk.source.parquet@2.0.0"),
        node("split", "sprisk.validation.split@1.0.0"),
    ]);
    let edges = json!([edge("ingest.data", "split.data")]);
    let errs = errors(nodes, edges);
    assert!(
        matches!(errs.as_slice(), [CompileError::UnknownOperator { .. }]),
        "{errs:?}"
    );
}

#[test]
fn params_schema_cannot_reach_outside_itself() {
    // Gate A never touches the network or the filesystem to resolve a schema.
    // The file is a valid schema, so only disabled resolution makes this fail.
    let dir = tempfile::tempdir().unwrap();
    let schema = dir.path().join("schema.json");
    fs::write(&schema, r#"{"type": "object"}"#).unwrap();
    let file_ref = format!("file://{}", schema.display());
    for reference in [file_ref.as_str(), "http://127.0.0.1:9/schema.json"] {
        let op = operator(
            "sprisk.test.remote@1.0.0",
            &[],
            &[("data", "table")],
            json!({ "$ref": reference }),
        );
        let ops = tempfile::tempdir().unwrap();
        let path = ops.path().join("op/manifest.yaml");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, op.to_string()).unwrap();
        let registry = Registry::load_dir(ops.path()).unwrap();

        let errs = compile(
            &pipeline(json!([node("a", "sprisk.test.remote@1.0.0")]), json!([])),
            &registry,
        )
        .unwrap_err();

        assert!(
            matches!(errs.as_slice(), [CompileError::InvalidParamsSchema { .. }]),
            "{reference}: {errs:?}"
        );
    }
}

#[test]
fn reserved_node_id_is_refused() {
    let nodes = json!([node(
        sprisk_graph::RESERVED_NODE_IDS[0],
        "sprisk.source.parquet@1.0.0"
    )]);
    let (_dir, registry) = registry();
    let errs = compile(&pipeline(nodes, json!([])), &registry).unwrap_err();
    assert!(
        matches!(errs.as_slice(), [CompileError::ReservedNode(_)]),
        "{errs:?}"
    );
}
