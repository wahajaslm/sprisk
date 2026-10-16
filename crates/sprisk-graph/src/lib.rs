//! Pipeline compiler: checks a PipelineVersion against the registry and orders its steps.
//!
//! Gate A of arch doc §8 (structural). It reports every problem it finds, not just the first,
//! so a human or the AI planner can fix a pipeline in one pass.

use std::collections::{BTreeMap, HashMap};

use petgraph::algo::toposort;
use petgraph::graph::{DiGraph, NodeIndex};
use sprisk_contracts::{Operator, PipelineVersion, Port};
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
}

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
    pub params: serde_json::Map<String, serde_json::Value>,
    /// Sorted by input port name.
    pub inputs: Vec<Input>,
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
    let mut operators: HashMap<&str, &Operator> = HashMap::new();
    let mut graph = DiGraph::<&str, ()>::new();
    let mut index: HashMap<&str, NodeIndex> = HashMap::new();
    for node in &pipeline.nodes {
        let id = node.id.as_str();
        if index.contains_key(id) {
            errors.push(CompileError::DuplicateNode(id.to_owned()));
            continue;
        }
        index.insert(id, graph.add_node(id));
        match registry.get(&node.operator) {
            Some(op) => {
                operators.insert(id, op);
                errors.extend(check_params(id, op, &node.params));
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
        let (from_node, from_port) = split_port(&edge.from);
        let (to_node, to_port) = split_port(&edge.to);
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
            Step {
                node_id: id.to_owned(),
                operator: operators[id].clone(),
                params: nodes[id].params.clone().into(),
                inputs,
            }
        })
        .collect();
    Ok(Plan { steps })
}

fn check_params(
    node: &str,
    op: &Operator,
    params: &serde_json::Map<String, serde_json::Value>,
) -> Vec<CompileError> {
    let schema = serde_json::Value::Object(op.params_schema.clone());
    let validator = match jsonschema::validator_for(&schema) {
        Ok(v) => v,
        Err(e) => {
            return vec![CompileError::InvalidParamsSchema {
                node: node.to_owned(),
                operator: op.id.to_string(),
                reason: e.to_string(),
            }];
        }
    };
    let instance = serde_json::Value::Object(params.clone());
    validator
        .iter_errors(&instance)
        .map(|e| CompileError::InvalidParams {
            node: node.to_owned(),
            reason: e.to_string(),
        })
        .collect()
}

/// `PortRef` is schema-validated as `<node>.<port>`, so the split always succeeds.
fn split_port(port_ref: &str) -> (&str, &str) {
    port_ref.split_once('.').unwrap_or((port_ref, ""))
}

enum Lookup<'a> {
    UnknownNode,
    UnknownOperator,
    MissingPort,
    Found(&'a Port),
}

fn resolve_port<'a>(
    operators: &HashMap<&str, &'a Operator>,
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
