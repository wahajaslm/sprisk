#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;

use serde_json::{Value, json};
use sprisk_contracts::PipelineVersion;
use sprisk_graph::{CompileError, compile, execution_plan};
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
    registry_with_model("A model.")
}

/// The test registry, with a model whose manifest says `about`.
fn registry_with_model(about: &str) -> (tempfile::TempDir, Registry) {
    let mut model = operator(
        "sprisk.ml.model@1.0.0",
        &[("train", "table")],
        &[("model", "model")],
        json!({
            "type": "object",
            "required": ["target"],
            "properties": { "target": { "type": "string" }, "depth": { "type": "integer" } },
            "additionalProperties": false
        }),
    );
    model["description"] = json!(about);
    model["model"] =
        json!({ "tasks": ["classification"], "estimator": "ops:build", "complexity": 1 });
    let mut shift = operator(
        "sprisk.clean.shift@1.0.0",
        &[("train", "table"), ("test", "table")],
        &[("train", "table"), ("test", "table")],
        json!({ "type": "object", "required": ["by"], "properties": { "by": { "type": "number" } } }),
    );
    shift["description"] = json!(about);
    shift["fits_on_train"] = json!(true);
    let mut noisy = shift.clone();
    noisy["id"] = json!("sprisk.clean.noisy@1.0.0");
    noisy["effects"] = json!("nondeterministic");
    let mut online = shift.clone();
    online["id"] = json!("sprisk.clean.online@1.0.0");
    online["network"] = json!("egress_allowlisted");
    // Writes a model beside its tables: a fold passes on only tables and words.
    let mut modeller = shift.clone();
    modeller["id"] = json!("sprisk.clean.modeller@1.0.0");
    modeller["outputs"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "name": "fitted", "kind": "model" }));
    // Writes words beside its tables, as Vectorize text does (ADR-0058).
    let mut wordy = shift.clone();
    wordy["id"] = json!("sprisk.clean.wordy@1.0.0");
    wordy["outputs"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "name": "train_words", "kind": "matrix" }));
    let mut reader = shift.clone();
    reader["id"] = json!("sprisk.clean.reader@1.0.0");
    reader["params_schema"] = json!({
        "type": "object",
        "properties": { "lookup": { "type": "string", "x-sprisk-local-path": true } }
    });
    let mut with_words = operator(
        "sprisk.ml.train_words@1.0.0",
        &[("training_data", "table"), ("words", "matrix")],
        &[("model", "model")],
        json!({ "type": "object" }),
    );
    with_words["inputs"][1]["optional"] = json!(true);
    let ops = [
        model,
        with_words,
        operator(
            "sprisk.text.words@1.0.0",
            &[("data", "table")],
            &[("words", "matrix")],
            json!({ "type": "object" }),
        ),
        shift,
        noisy,
        online,
        modeller,
        wordy,
        reader,
        operator(
            "sprisk.ml.compare@1.0.0",
            &[("train", "table")],
            &[("scores", "table")],
            json!({
                "type": "object",
                "properties": {
                    "candidate": { "type": "string", "x-sprisk-model-operator": "candidate_params" },
                    "candidate_params": { "type": "object" },
                    "prepare": { "type": "array", "x-sprisk-preparation": true }
                }
            }),
        ),
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
            "sprisk.io.file@1.0.0",
            &[],
            &[("data", "table")],
            json!({
                "type": "object",
                "properties": { "path": { "type": "string", "x-sprisk-local-path": true } }
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
        operator(
            "sprisk.code.cells@1.0.0",
            &[],
            &[("display", "diagnostics")],
            json!({
                "type": "object",
                "properties": {
                    "source": { "type": "string" },
                    "inputs": { "type": "array", "items": { "type": "string" }, "x-sprisk-ports": "input" },
                    "outputs": { "type": "array", "items": { "type": "string" }, "x-sprisk-ports": "output" }
                }
            }),
        ),
        operator(
            "sprisk.code.typo@1.0.0",
            &[],
            &[],
            json!({
                "type": "object",
                "properties": { "names": { "type": "array", "x-sprisk-ports": "inptu" } }
            }),
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
fn an_optional_input_may_be_left_unconnected_and_keeps_its_kind() {
    let (_dir, registry) = registry();
    let nodes = json!([
        node("ingest", "sprisk.source.parquet@1.0.0"),
        node("train", "sprisk.ml.train_words@1.0.0"),
    ]);
    let fed = edge("ingest.data", "train.training_data");
    let plan = compile(&pipeline(nodes.clone(), json!([fed])), &registry).unwrap();
    let train = plan.steps.iter().find(|s| s.node_id == "train").unwrap();
    assert_eq!(train.inputs.len(), 1);

    let errs = errors(nodes, json!([fed, edge("ingest.data", "train.words")]));
    assert!(
        errs.contains(&CompileError::KindMismatch {
            from: "ingest.data".into(),
            to: "train.words".into(),
            from_kind: "table".into(),
            to_kind: "matrix".into(),
        }),
        "{errs:?}"
    );
}

#[test]
fn an_optional_input_is_still_fed_at_most_once() {
    let nodes = json!([
        node("ingest", "sprisk.source.parquet@1.0.0"),
        node("words", "sprisk.text.words@1.0.0"),
        node("train", "sprisk.ml.train_words@1.0.0"),
    ]);
    let edges = json!([
        edge("ingest.data", "words.data"),
        edge("ingest.data", "train.training_data"),
        edge("words.words", "train.words"),
        edge("words.words", "train.words"),
    ]);
    let errs = errors(nodes, edges);
    assert!(
        errs.contains(&CompileError::ConnectedTwice("train.words".into())),
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
fn node_ids_the_control_plane_uses_for_its_checks_are_refused() {
    let (_dir, registry) = registry();
    for id in ["gate_b", "gate_split"] {
        let nodes = json!([node(id, "sprisk.source.parquet@1.0.0")]);
        let errs = compile(&pipeline(nodes, json!([])), &registry).unwrap_err();
        assert!(
            matches!(errs.as_slice(), [CompileError::ReservedNode(n)] if n == id),
            "{id}: {errs:?}"
        );
    }
}

#[test]
fn a_step_with_its_own_code_gets_that_code_and_its_own_digest() {
    let (_dir, registry) = registry();
    let mut nodes = valid_nodes();
    nodes[1]["code"] =
        json!({ "source": "def train(training_data):\n    ...\n", "function": "train" });

    let plan = compile(&pipeline(nodes, valid_edges()), &registry).unwrap();

    let train = plan.steps.iter().find(|s| s.node_id == "train").unwrap();
    let split = plan.steps.iter().find(|s| s.node_id == "split").unwrap();
    assert_eq!(train.code.as_ref().unwrap().function.as_str(), "train");
    assert_ne!(
        Some(train.implementation_digest.as_str()),
        registry.digest("sprisk.ml.train@1.0.0")
    );
    assert!(train.implementation_digest.starts_with("sha256:"));
    assert_eq!(
        Some(split.implementation_digest.as_str()),
        registry.digest("sprisk.validation.split@1.0.0")
    );
    assert!(split.code.is_none());
}

#[test]
fn a_step_that_reads_files_cannot_carry_its_own_code() {
    // Its own code could ignore the data-root check its path setting passed (ADR-0028).
    let nodes = json!([{
        "id": "load", "operator": "sprisk.io.file@1.0.0", "params": { "path": "/data/a.csv" },
        "code": { "source": "def run(path):\n    ...\n", "function": "run" }
    }]);
    let found = errors(nodes, json!([]));
    assert!(
        found
            .iter()
            .any(|e| e.code() == "code_not_allowed" && e.to_string().contains("load")),
        "{found:?}"
    );
}

fn cell(id: &str, inputs: &[&str], outputs: &[&str]) -> Value {
    json!({
        "id": id,
        "operator": "sprisk.code.cells@1.0.0",
        "params": { "source": "", "inputs": inputs, "outputs": outputs }
    })
}

#[test]
fn a_code_step_s_ports_are_the_names_in_its_params() {
    let (_dir, registry) = registry();
    let nodes = json!([
        cell("cell_1", &[], &["df"]),
        cell("cell_2", &["df"], &["filtered"]),
        node("split", "sprisk.validation.split@1.0.0"),
    ]);
    let edges = json!([
        edge("cell_1.df", "cell_2.df"),
        edge("cell_2.filtered", "split.data")
    ]);

    let plan = compile(&pipeline(nodes, edges), &registry).unwrap();

    let second = plan.steps.iter().find(|s| s.node_id == "cell_2").unwrap();
    assert_eq!(second.inputs[0].from_node, "cell_1");
    let outputs: Vec<(String, String)> = second
        .operator
        .outputs
        .iter()
        .map(|p| (p.name.to_string(), p.kind.to_string()))
        .collect();
    assert_eq!(
        outputs,
        [
            ("display".to_owned(), "diagnostics".to_owned()),
            ("filtered".to_owned(), "table".to_owned())
        ]
    );
}

#[test]
fn a_code_step_needs_every_name_it_reads_connected_and_no_others() {
    let nodes = json!([
        cell("cell_1", &[], &["df"]),
        cell("cell_2", &["df", "lookup"], &[])
    ]);
    let edges = json!([
        edge("cell_1.df", "cell_2.df"),
        edge("cell_1.df", "cell_2.other")
    ]);
    let codes: Vec<&str> = errors(nodes, edges)
        .iter()
        .map(CompileError::code)
        .collect();
    assert_eq!(codes, ["not_an_input", "unconnected_input"]);
}

#[test]
fn a_port_name_must_be_a_valid_name() {
    let nodes = json!([cell("cell_1", &[], &["X_train"])]);
    let codes: Vec<&str> = errors(nodes, json!([]))
        .iter()
        .map(CompileError::code)
        .collect();
    assert_eq!(codes, ["invalid_port_name"]);
}

#[test]
fn a_reserved_name_cannot_be_a_port() {
    let nodes = json!([cell("cell_1", &[], &["console"])]);
    let codes: Vec<&str> = errors(nodes, json!([]))
        .iter()
        .map(CompileError::code)
        .collect();
    assert_eq!(codes, ["invalid_port_name"]);
}

#[test]
fn a_port_marker_must_say_input_or_output() {
    let nodes =
        json!([{ "id": "a", "operator": "sprisk.code.typo@1.0.0", "params": { "names": ["x"] } }]);
    let codes: Vec<&str> = errors(nodes, json!([]))
        .iter()
        .map(CompileError::code)
        .collect();
    assert_eq!(codes, ["invalid_params_schema"]);
}

fn comparing(candidate: &str, candidate_params: Value) -> Value {
    json!([
        node("ingest", "sprisk.source.parquet@1.0.0"),
        {
            "id": "cv", "operator": "sprisk.ml.compare@1.0.0",
            "params": { "candidate": candidate, "candidate_params": candidate_params }
        }
    ])
}

fn comparing_edges() -> Value {
    json!([edge("ingest.data", "cv.train")])
}

#[test]
fn a_step_naming_a_model_is_cached_by_the_models_code_too() {
    let digest_with = |about: &str| {
        let (_dir, registry) = registry_with_model(about);
        let nodes = comparing("sprisk.ml.model@1.0.0", json!({ "target": "y" }));
        let plan = compile(&pipeline(nodes, comparing_edges()), &registry).unwrap();
        let cv = plan.steps.iter().find(|s| s.node_id == "cv").unwrap();
        let own = registry
            .digest("sprisk.ml.compare@1.0.0")
            .unwrap()
            .to_owned();
        (own, cv.implementation_digest.clone())
    };
    let (own, first) = digest_with("A model.");
    let (same_own, edited) = digest_with("The model, edited.");

    assert_eq!(own, same_own);
    assert_ne!(first, own);
    assert_ne!(first, edited);
    assert!(first.starts_with("sha256:"));
}

#[test]
fn a_step_must_name_a_registered_model_with_an_estimator() {
    for candidate in ["sprisk.ml.missing@1.0.0", "sprisk.ml.train@1.0.0"] {
        let found = errors(
            comparing(candidate, json!({ "target": "y" })),
            comparing_edges(),
        );
        assert_eq!(
            found,
            [CompileError::NotAModel {
                node: "cv".into(),
                setting: "candidate".into(),
                operator: candidate.into()
            }],
            "{candidate}"
        );
        assert_eq!(found[0].code(), "not_a_model");
    }
}

#[test]
fn the_named_models_params_must_pass_its_own_schema() {
    let found = errors(
        comparing("sprisk.ml.model@1.0.0", json!({ "depth": "deep" })),
        comparing_edges(),
    );
    let reasons: Vec<String> = found.iter().map(ToString::to_string).collect();
    assert_eq!(found.len(), 2, "{reasons:?}");
    assert!(
        found.iter().all(|e| e.code() == "invalid_params"),
        "{reasons:?}"
    );
    assert!(
        reasons
            .iter()
            .all(|r| r.starts_with("node cv: invalid params: candidate_params: ")),
        "{reasons:?}"
    );
}

#[test]
fn a_step_naming_a_model_cannot_carry_its_own_code() {
    let mut nodes = comparing("sprisk.ml.model@1.0.0", json!({ "target": "y" }));
    nodes[1]["code"] = json!({ "source": "def run(train, candidate, candidate_params):\n    ...\n", "function": "run" });
    let found = errors(nodes, comparing_edges());
    assert!(
        found.iter().any(|e| e.code() == "code_not_allowed"
            && e.to_string().contains("names other steps to run")),
        "{found:?}"
    );
}

fn preparing(prepare: Value) -> Value {
    let mut nodes = comparing("sprisk.ml.model@1.0.0", json!({ "target": "y" }));
    nodes[1]["params"]["prepare"] = prepare;
    nodes
}

#[test]
fn a_preparation_step_must_be_registered_fit_on_train_pure_offline_read_no_files_and_write_only_tables_or_words()
 {
    for operator in [
        "sprisk.clean.missing@1.0.0",
        "sprisk.validation.split@1.0.0",
        "sprisk.clean.noisy@1.0.0",
        "sprisk.clean.online@1.0.0",
        "sprisk.clean.reader@1.0.0",
        "sprisk.clean.modeller@1.0.0",
    ] {
        let found = errors(
            preparing(json!([{ "operator": operator, "params": {} }])),
            comparing_edges(),
        );
        assert_eq!(
            found,
            [CompileError::NotAPreparation {
                node: "cv".into(),
                operator: operator.into()
            }],
            "{operator}"
        );
        assert_eq!(found[0].code(), "not_a_preparation");
    }
}

#[test]
fn a_preparation_step_may_make_words() {
    let (_dir, registry) = registry();
    let steps = json!([{ "operator": "sprisk.clean.wordy@1.0.0", "params": { "by": 1 } }]);
    assert!(compile(&pipeline(preparing(steps), comparing_edges()), &registry).is_ok());
}

#[test]
fn a_preparation_step_s_params_must_pass_its_schema() {
    let found = errors(
        preparing(json!([{ "operator": "sprisk.clean.shift@1.0.0", "params": {} }])),
        comparing_edges(),
    );
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(
        found[0]
            .to_string()
            .starts_with("node cv: invalid params: prepare[0] sprisk.clean.shift@1.0.0: "),
        "{found:?}"
    );
}

#[test]
fn a_comparison_is_cached_by_its_preparation_steps_code_too() {
    let (_dir, registry) = registry();
    let digest = |prepare: Value| {
        let plan = compile(&pipeline(preparing(prepare), comparing_edges()), &registry).unwrap();
        let cv = plan.steps.iter().find(|s| s.node_id == "cv").unwrap();
        cv.implementation_digest.clone()
    };
    let shift = json!([{ "operator": "sprisk.clean.shift@1.0.0", "params": { "by": 1.0 } }]);
    assert_ne!(digest(json!([])), digest(shift));
}

fn plugins() -> Registry {
    Registry::load_dir(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins"))
        .unwrap()
}

/// A model step that leaves its features unset, or a comparison candidate that does, never
/// reads the key columns; one that lists its features reads only those.
#[test]
fn key_columns_are_left_out_of_every_model_that_reads_every_column() {
    let flow = pipeline(
        json!([
            { "id": "load", "operator": "sprisk.io.file_source@1.0.0", "params": { "path": "/d.csv", "format": "csv" } },
            { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": { "test_fraction": 0.2, "seed": 1 } },
            { "id": "all", "operator": "sprisk.ml.linear_model@3.0.0",
              "params": { "target": "y", "task": "classification", "exclude": ["note"] } },
            { "id": "listed", "operator": "sprisk.ml.random_forest@3.0.0",
              "params": { "target": "y", "task": "classification", "features": ["age"] } },
            { "id": "cv", "operator": "sprisk.ml.cross_validate@4.0.0",
              "params": { "candidate": "sprisk.ml.linear_model@3.0.0",
                          "candidate_params": { "target": "y", "task": "classification" },
                          "folds": 5, "repeats": 1, "seed": 0, "metric": "balanced_accuracy", "prepare": [] } }
        ]),
        json!([
            { "from": "load.data", "to": "split.data" },
            { "from": "split.train", "to": "all.train" },
            { "from": "split.train", "to": "listed.train" },
            { "from": "split.train", "to": "cv.train" }
        ]),
    );
    let mut plan = compile(&flow, &plugins()).unwrap();
    let keys = ["customer".to_owned(), "day".to_owned()]
        .into_iter()
        .collect();
    sprisk_graph::leave_out_keys(&mut plan, &keys).unwrap();
    let params = |id: &str| {
        plan.steps
            .iter()
            .find(|s| s.node_id == id)
            .unwrap()
            .params
            .clone()
    };
    assert_eq!(params("all")["exclude"], json!(["customer", "day", "note"]));
    assert!(params("listed").get("exclude").is_none());
    assert_eq!(
        params("cv")["candidate_params"]["exclude"],
        json!(["customer", "day"])
    );
    assert!(params("split").get("exclude").is_none());
}

#[test]
fn an_exclude_that_is_not_a_list_of_names_is_an_error_not_an_empty_list() {
    let flow = pipeline(
        json!([
            { "id": "load", "operator": "sprisk.io.file_source@1.0.0", "params": { "path": "/d.csv", "format": "csv" } },
            { "id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": { "test_fraction": 0.2, "seed": 1 } },
            { "id": "all", "operator": "sprisk.ml.linear_model@3.0.0",
              "params": { "target": "y", "task": "classification" } }
        ]),
        json!([
            { "from": "load.data", "to": "split.data" },
            { "from": "split.train", "to": "all.train" }
        ]),
    );
    let mut plan = compile(&flow, &plugins()).unwrap();
    plan.steps
        .iter_mut()
        .find(|s| s.node_id == "all")
        .unwrap()
        .params
        .insert("exclude".into(), json!("note"));
    let keys = ["customer".to_owned()].into_iter().collect();
    let err = sprisk_graph::leave_out_keys(&mut plan, &keys).unwrap_err();
    assert!(err.to_string().contains("all"), "{err}");
}

/// The plan Gate B reads (ADR-0070): each step's resolved ports, and which inputs' rows each
/// output holds.
#[test]
fn the_execution_plan_names_each_output_s_rows_and_a_code_step_s_own_ports() {
    let (_dir, registry) = registry();
    let mut code = node("look", "sprisk.code.cells@1.0.0");
    code["params"] = json!({ "source": "x", "inputs": ["rows"], "outputs": ["summary"] });
    let mut words = node("words", "sprisk.clean.wordy@1.0.0");
    words["params"] = json!({ "by": 1 });
    let version = pipeline(
        json!([
            node("ingest", "sprisk.source.parquet@1.0.0"),
            node("split", "sprisk.validation.split@1.0.0"),
            words,
            code,
        ]),
        json!([
            edge("ingest.data", "split.data"),
            edge("split.train", "words.train"),
            edge("split.validation", "words.test"),
            edge("words.train", "look.rows"),
        ]),
    );
    let plan = compile(&version, &registry).unwrap();

    let made = serde_json::to_value(execution_plan(&version, &plan).unwrap()).unwrap();

    let step = |id: &str| {
        made["steps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["node_id"] == id)
            .unwrap()
            .clone()
    };
    let rows_from = |id: &str, port: &str| {
        step(id)["outputs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["name"] == port)
            .unwrap()["rows_from"]
            .clone()
    };
    assert_eq!(made["schema_version"], "sprisk.execution_plan/v1");
    assert_eq!(
        made["pipeline_version_id"],
        "plv_01JABCDEFGHJKMNPQRSTVWXYZ0"
    );
    assert_eq!(rows_from("split", "train"), json!(["data"]));
    assert_eq!(rows_from("words", "train"), json!(["train"]));
    assert_eq!(rows_from("words", "train_words"), json!(["train"]));
    assert_eq!(rows_from("words", "test"), json!(["test", "train"]));
    assert_eq!(rows_from("look", "summary"), json!(["rows"]));
    assert_eq!(
        step("look")["inputs"],
        json!([{ "port": "rows", "from": "words.train" }])
    );
}
