//! Pipeline compiler: checks a PipelineVersion against the registry and orders its steps.
//!
//! Gate A of arch doc §8 (structural). It reports every problem it finds, not just the first,
//! so a human or the AI planner can fix a pipeline in one pass.

use std::collections::{BTreeMap, HashMap};

use petgraph::algo::toposort;
use petgraph::graph::{DiGraph, NodeIndex};
use sprisk_contracts::{Operator, PipelineVersion, Port, PortKind, PortName};
use sprisk_registry::Registry;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CompileError {
    #[error("pipeline has no nodes")]
    Empty,
    #[error("node id {0} is used more than once")]
    DuplicateNode(String),
    #[error("node {node}: operator {operator} is not registered")]
    UnknownOperator { node: String, operator: String },
    #[error("node {node}: invalid params: {reason}")]
    InvalidParams { node: String, reason: String },
    #[error("node {node}: operator {operator} has an invalid params_schema: {reason}")]
    InvalidParamsSchema {
        node: String,
        operator: String,
        reason: String,
    },
    #[error("edge refers to unknown node {0}")]
    UnknownNode(String),
    #[error("{0} is not an output port")]
    NotAnOutput(String),
    #[error("{0} is not an input port")]
    NotAnInput(String),
    #[error("{from} ({from_kind}) cannot feed {to} ({to_kind})")]
    KindMismatch {
        from: String,
        to: String,
        from_kind: String,
        to_kind: String,
    },
    #[error("input {0} is not connected")]
    Unconnected(String),
    #[error("input {0} is connected more than once")]
    ConnectedTwice(String),
    #[error("pipeline has a cycle through node {0}")]
    Cycle(String),
    #[error("node id {0} is reserved")]
    ReservedNode(String),
    #[error("node {node}: {name:?} cannot be a port: {reason}")]
    InvalidPortName {
        node: String,
        name: String,
        reason: &'static str,
    },
    #[error(
        "node {node}: {setting} names {operator}, which is not a registered model with an estimator"
    )]
    NotAModel {
        node: String,
        setting: String,
        operator: String,
    },
    #[error(
        "node {node}: {operator} is not a registered step that fits on train, so it cannot be refit per fold"
    )]
    NotAPreparation { node: String, operator: String },
    #[error("node {node}: {operator} cannot carry its own code: {reason}")]
    CodeNotAllowed {
        node: String,
        operator: String,
        reason: &'static str,
    },
}

/// Ports every step may send without declaring them: what it printed (ADR-0025).
const RESERVED_PORTS: [&str; 1] = ["console"];

/// Node ids with this prefix are the control plane's own attempts: `gate_b` (ADR-0017) and
/// each split's row check `gate_<split>` (ADR-0040).
pub const RESERVED_NODE_PREFIX: &str = "gate_";

impl CompileError {
    /// Stable snake_case code for API problem responses.
    pub fn code(&self) -> &'static str {
        match self {
            CompileError::Empty => "empty_pipeline",
            CompileError::DuplicateNode(_) => "duplicate_node",
            CompileError::UnknownOperator { .. } => "unknown_operator",
            CompileError::InvalidParams { .. } => "invalid_params",
            CompileError::InvalidParamsSchema { .. } => "invalid_params_schema",
            CompileError::UnknownNode(_) => "unknown_node",
            CompileError::NotAnOutput(_) => "not_an_output",
            CompileError::NotAnInput(_) => "not_an_input",
            CompileError::KindMismatch { .. } => "kind_mismatch",
            CompileError::Unconnected(_) => "unconnected_input",
            CompileError::ConnectedTwice(_) => "input_connected_twice",
            CompileError::Cycle(_) => "cycle",
            CompileError::ReservedNode(_) => "reserved_node_id",
            CompileError::CodeNotAllowed { .. } => "code_not_allowed",
            CompileError::InvalidPortName { .. } => "invalid_port_name",
            CompileError::NotAModel { .. } => "not_a_model",
            CompileError::NotAPreparation { .. } => "not_a_preparation",
        }
    }
}

/// A compiled pipeline: steps in an order where every step comes after its inputs.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub node_id: String,
    pub operator: Operator,
    /// Digest of the code that runs this step (arch §9 cache key): the registry's, or that of
    /// the step's own code (ADR-0028).
    pub implementation_digest: String,
    pub params: serde_json::Map<String, serde_json::Value>,
    /// Sorted by input port name.
    pub inputs: Vec<Input>,
    /// The step's own code in this version, run instead of its operator's (ADR-0028).
    pub code: Option<sprisk_contracts::NodeCode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Input {
    pub port: String,
    pub from_node: String,
    pub from_port: String,
}

pub fn compile(pipeline: &PipelineVersion, registry: &Registry) -> Result<Plan, Vec<CompileError>> {
    if pipeline.nodes.is_empty() {
        return Err(vec![CompileError::Empty]);
    }
    let mut errors = Vec::new();

    // Resolve each node to its operator and check its params.
    // Each node's operator with the ports its params name (ADR-0031).
    let mut operators: HashMap<&str, Operator> = HashMap::new();
    let mut digests: HashMap<&str, String> = HashMap::new();
    let mut graph = DiGraph::<&str, ()>::new();
    let mut index: HashMap<&str, NodeIndex> = HashMap::new();
    for node in &pipeline.nodes {
        let id = node.id.as_str();
        if id.starts_with(RESERVED_NODE_PREFIX) {
            errors.push(CompileError::ReservedNode(id.to_owned()));
        }
        if index.contains_key(id) {
            errors.push(CompileError::DuplicateNode(id.to_owned()));
            continue;
        }
        index.insert(id, graph.add_node(id));
        match registry.resolve(&node.operator) {
            Some((op, digest)) => {
                errors.extend(check_params(id, op, &node.params));
                let models = named_models(id, op, &node.params, registry);
                let preparations = named_preparations(id, op, &node.params, registry);
                match (models, preparations) {
                    (Ok(models), Ok(preparations)) => {
                        let named: Vec<&str> = models.into_iter().chain(preparations).collect();
                        digests.insert(id, with_models(digest, &named));
                    }
                    (models, preparations) => {
                        errors.extend(models.err().into_iter().flatten());
                        errors.extend(preparations.err().into_iter().flatten());
                    }
                }
                if node.code.is_some() {
                    errors.extend(check_own_code(id, op));
                }
                match with_named_ports(id, op, &node.params) {
                    Ok(op) => {
                        operators.insert(id, op);
                    }
                    Err(e) => errors.extend(e),
                }
            }
            None => errors.push(CompileError::UnknownOperator {
                node: id.to_owned(),
                operator: node.operator.to_string(),
            }),
        }
    }

    // Check edges and collect, per input, what feeds it.
    let mut feeds: BTreeMap<(&str, &str), Vec<(&str, &str)>> = BTreeMap::new();
    for edge in &pipeline.edges {
        let (from_node, from_port) = edge.from.step_and_port();
        let (to_node, to_port) = edge.to.step_and_port();
        let from = resolve_port(&operators, &index, from_node, from_port, |op| &op.outputs);
        let to = resolve_port(&operators, &index, to_node, to_port, |op| &op.inputs);
        match (from, to) {
            (Lookup::Found(out), Lookup::Found(inp)) => {
                if out.kind != inp.kind {
                    errors.push(CompileError::KindMismatch {
                        from: edge.from.to_string(),
                        to: edge.to.to_string(),
                        from_kind: out.kind.to_string(),
                        to_kind: inp.kind.to_string(),
                    });
                }
                feeds
                    .entry((to_node, to_port))
                    .or_default()
                    .push((from_node, from_port));
                graph.add_edge(index[from_node], index[to_node], ());
            }
            (from, to) => {
                // The input is fed, even if its source is broken; don't also call it unconnected.
                if matches!(to, Lookup::Found(_)) {
                    feeds
                        .entry((to_node, to_port))
                        .or_default()
                        .push((from_node, from_port));
                }
                for (lookup, node, missing) in [
                    (
                        from,
                        from_node,
                        CompileError::NotAnOutput(edge.from.to_string()),
                    ),
                    (to, to_node, CompileError::NotAnInput(edge.to.to_string())),
                ] {
                    match lookup {
                        Lookup::UnknownNode => {
                            errors.push(CompileError::UnknownNode(node.to_owned()))
                        }
                        Lookup::MissingPort => errors.push(missing),
                        // Unknown operator was already reported for the node.
                        Lookup::UnknownOperator | Lookup::Found(_) => {}
                    }
                }
            }
        }
    }

    // Every input of every resolved node is fed exactly once.
    for node in &pipeline.nodes {
        let Some(op) = operators.get(node.id.as_str()) else {
            continue;
        };
        for input in &op.inputs {
            let key = (node.id.as_str(), input.name.as_str());
            let name = format!("{}.{}", key.0, key.1);
            match feeds.get(&key).map_or(0, Vec::len) {
                0 => errors.push(CompileError::Unconnected(name)),
                1 => {}
                _ => errors.push(CompileError::ConnectedTwice(name)),
            }
        }
    }

    let order = match toposort(&graph, None) {
        Ok(order) => order,
        Err(cycle) => {
            errors.push(CompileError::Cycle(graph[cycle.node_id()].to_owned()));
            Vec::new()
        }
    };
    if !errors.is_empty() {
        return Err(errors);
    }

    let nodes: HashMap<&str, _> = pipeline.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let steps = order
        .into_iter()
        .map(|i| {
            let id = graph[i];
            let inputs = feeds
                .range((id, "")..)
                .take_while(|((node, _), _)| *node == id)
                .map(|((_, port), sources)| Input {
                    port: (*port).to_owned(),
                    from_node: sources[0].0.to_owned(),
                    from_port: sources[0].1.to_owned(),
                })
                .collect();
            let code = nodes[id].code.clone();
            Step {
                node_id: id.to_owned(),
                operator: operators[id].clone(),
                implementation_digest: code
                    .as_ref()
                    .map_or_else(|| digests[id].clone(), own_code_digest),
                params: nodes[id].params.clone().into(),
                inputs,
                code,
            }
        })
        .collect();
    Ok(Plan { steps })
}

/// A code step's ports are variable names listed in its params (ADR-0031). A params property
/// marked `x-sprisk-ports: input | output` lists them; each is a table port.
fn with_named_ports(
    node: &str,
    op: &Operator,
    params: &serde_json::Map<String, serde_json::Value>,
) -> Result<Operator, Vec<CompileError>> {
    let mut named = op.clone();
    let mut errors = Vec::new();
    let schema_error = |reason: String| CompileError::InvalidParamsSchema {
        node: node.to_owned(),
        operator: op.id.to_string(),
        reason,
    };
    let properties = op
        .params_schema
        .get("properties")
        .and_then(|p| p.as_object());
    let mut sides_seen = Vec::new();
    for (key, schema) in properties.into_iter().flatten() {
        let Some(side) = schema.get("x-sprisk-ports") else {
            continue;
        };
        let ports = match side.as_str() {
            Some("input") => &mut named.inputs,
            Some("output") => &mut named.outputs,
            _ => {
                errors.push(schema_error(format!(
                    "x-sprisk-ports on {key} must be input or output"
                )));
                continue;
            }
        };
        if sides_seen.contains(&side) {
            errors.push(schema_error(format!(
                "more than one setting lists {side} ports"
            )));
            continue;
        }
        sides_seen.push(side);
        let names = params
            .get(key)
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten();
        for name in names.filter_map(|n| n.as_str()) {
            let bad = |reason| CompileError::InvalidPortName {
                node: node.to_owned(),
                name: name.to_owned(),
                reason,
            };
            let Ok(port_name) = name.parse::<PortName>() else {
                errors.push(bad("port names are lowercase letters, digits and _"));
                continue;
            };
            if RESERVED_PORTS.contains(&name) || ports.iter().any(|p| p.name == port_name) {
                errors.push(bad("the step already has a port with this name"));
                continue;
            }
            ports.push(Port {
                name: port_name,
                kind: PortKind::Table,
                description: None,
            });
        }
    }
    if errors.is_empty() {
        Ok(named)
    } else {
        Err(errors)
    }
}

/// A setting marked `x-sprisk-model-operator: <key>` names a registered model with an
/// estimator, and setting `<key>` holds that model's params (ADR-0046). Gives the digests of
/// the models named, so the step's cache key follows their code.
fn named_models<'r>(
    node: &str,
    op: &Operator,
    params: &serde_json::Map<String, serde_json::Value>,
    registry: &'r Registry,
) -> Result<Vec<&'r str>, Vec<CompileError>> {
    let mut digests = Vec::new();
    let mut errors = Vec::new();
    for (setting, schema) in properties(op) {
        let Some(marker) = schema.get("x-sprisk-model-operator") else {
            continue;
        };
        let Some(params_setting) = marker.as_str() else {
            errors.push(CompileError::InvalidParamsSchema {
                node: node.to_owned(),
                operator: op.id.to_string(),
                reason: format!("x-sprisk-model-operator on {setting} must name a setting"),
            });
            continue;
        };
        // A missing or mistyped setting is already an invalid param.
        let Some(model_ref) = params.get(setting).and_then(|v| v.as_str()) else {
            continue;
        };
        let Some((model, digest)) = registry
            .resolve(model_ref)
            .filter(|(m, _)| m.model.as_ref().is_some_and(|m| m.estimator.is_some()))
        else {
            errors.push(CompileError::NotAModel {
                node: node.to_owned(),
                setting: setting.clone(),
                operator: model_ref.to_owned(),
            });
            continue;
        };
        let model_params = params.get(params_setting).cloned().unwrap_or_default();
        match validate_against(model, &model_params) {
            Ok(reasons) => {
                errors.extend(
                    reasons
                        .into_iter()
                        .map(|reason| CompileError::InvalidParams {
                            node: node.to_owned(),
                            reason: format!("{params_setting}: {reason}"),
                        }),
                )
            }
            Err(reason) => errors.push(CompileError::InvalidParamsSchema {
                node: node.to_owned(),
                operator: model.id.to_string(),
                reason,
            }),
        }
        digests.push(digest);
    }
    if errors.is_empty() {
        Ok(digests)
    } else {
        Err(errors)
    }
}

/// A setting marked `x-sprisk-preparation` lists `{operator, params}` steps that the step refits
/// per fold (ADR-0047). Each must be a registered operator that fits on train, with params its
/// schema accepts. Gives their digests, so the step's cache key follows their code.
fn named_preparations<'r>(
    node: &str,
    op: &Operator,
    params: &serde_json::Map<String, serde_json::Value>,
    registry: &'r Registry,
) -> Result<Vec<&'r str>, Vec<CompileError>> {
    let mut digests = Vec::new();
    let mut errors = Vec::new();
    let marked = properties(op).filter(|(_, v)| v.get("x-sprisk-preparation").is_some());
    for (setting, _) in marked {
        // A missing or mistyped list is already an invalid param.
        let steps = params
            .get(setting)
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten();
        for (i, step) in steps.enumerate() {
            let Some(operator) = step.get("operator").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some((found, digest)) = registry
                .resolve(operator)
                .filter(|(o, _)| o.fits_on_train == Some(true))
            else {
                errors.push(CompileError::NotAPreparation {
                    node: node.to_owned(),
                    operator: operator.to_owned(),
                });
                continue;
            };
            let step_params = step.get("params").cloned().unwrap_or_default();
            match validate_against(found, &step_params) {
                Ok(reasons) => {
                    errors.extend(
                        reasons
                            .into_iter()
                            .map(|reason| CompileError::InvalidParams {
                                node: node.to_owned(),
                                reason: format!("{setting}[{i}] {operator}: {reason}"),
                            }),
                    )
                }
                Err(reason) => errors.push(CompileError::InvalidParamsSchema {
                    node: node.to_owned(),
                    operator: found.id.to_string(),
                    reason,
                }),
            }
            digests.push(digest);
        }
    }
    if errors.is_empty() {
        Ok(digests)
    } else {
        Err(errors)
    }
}

/// The step's own digest, joined with those of the models and steps it names.
fn with_models(own: &str, models: &[&str]) -> String {
    if models.is_empty() {
        return own.to_owned();
    }
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for digest in std::iter::once(own).chain(models.iter().copied()) {
        hasher.update(digest.as_bytes());
        hasher.update([0]);
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn properties(op: &Operator) -> impl Iterator<Item = (&String, &serde_json::Value)> {
    op.params_schema
        .get("properties")
        .and_then(|p| p.as_object())
        .into_iter()
        .flatten()
}

/// A step's own code runs instead of its operator's (ADR-0028). Only pure steps that read no
/// files and name no model may carry it: replacement code could ignore the data-root check a
/// path setting passed, or the model a setting names, or add effects that caching and
/// approval would not see.
fn check_own_code(node: &str, op: &Operator) -> Option<CompileError> {
    let marked = |marker: &str| properties(op).any(|(_, v)| v.get(marker).is_some());
    let reads_files = properties(op)
        .any(|(_, v)| v.get("x-sprisk-local-path") == Some(&serde_json::Value::Bool(true)));
    let reason = if reads_files {
        "it reads files, and its code must stay the checked one"
    } else if marked("x-sprisk-model-operator") || marked("x-sprisk-preparation") {
        "it names other steps to run, and its code must stay the checked one"
    } else if op.effects != sprisk_contracts::Effects::Pure {
        "it is not a pure step"
    } else {
        return None;
    };
    Some(CompileError::CodeNotAllowed {
        node: node.to_owned(),
        operator: op.id.to_string(),
        reason,
    })
}

/// The digest of a step's own code: different code never shares a cache entry (ADR-0028).
fn own_code_digest(code: &sprisk_contracts::NodeCode) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(code.function.as_bytes());
    hasher.update([0]);
    hasher.update(code.source.as_bytes());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn check_params(
    node: &str,
    op: &Operator,
    params: &serde_json::Map<String, serde_json::Value>,
) -> Vec<CompileError> {
    let instance = serde_json::Value::Object(params.clone());
    match validate_against(op, &instance) {
        Ok(reasons) => reasons
            .into_iter()
            .map(|reason| CompileError::InvalidParams {
                node: node.to_owned(),
                reason,
            })
            .collect(),
        Err(reason) => vec![CompileError::InvalidParamsSchema {
            node: node.to_owned(),
            operator: op.id.to_string(),
            reason,
        }],
    }
}

/// Why `instance` fails `op`'s params schema, or the schema's own error.
fn validate_against(op: &Operator, instance: &serde_json::Value) -> Result<Vec<String>, String> {
    let schema = serde_json::Value::Object(op.params_schema.clone());
    let validator = jsonschema::validator_for(&schema).map_err(|e| e.to_string())?;
    Ok(validator
        .iter_errors(instance)
        .map(|e| e.to_string())
        .collect())
}

enum Lookup<'a> {
    UnknownNode,
    UnknownOperator,
    MissingPort,
    Found(&'a Port),
}

fn resolve_port<'a>(
    operators: &'a HashMap<&str, Operator>,
    index: &HashMap<&str, NodeIndex>,
    node: &str,
    port: &str,
    ports: impl Fn(&'a Operator) -> &'a Vec<Port>,
) -> Lookup<'a> {
    if !index.contains_key(node) {
        return Lookup::UnknownNode;
    }
    let Some(op) = operators.get(node) else {
        return Lookup::UnknownOperator;
    };
    match ports(op).iter().find(|p| p.name.as_str() == port) {
        Some(p) => Lookup::Found(p),
        None => Lookup::MissingPort,
    }
}
