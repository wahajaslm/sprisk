//! One way to change a flow (ADR-0063): a patch of typed effects, each checked against the
//! flow as the effects before it left it. The caller compiles the result, which refuses
//! cycles and port types; any refusal leaves the flow given unchanged.

use serde_json::json;
use sprisk_contracts::{Edge, GraphEffect, Node, Operator, PipelineVersion, PortRef, parse};

use crate::compare::edge;
use crate::{ResolveError, with_node_before, without_node};

/// The nodes and edges of `pipeline` once every effect is applied, in order.
pub fn apply<'a>(
    pipeline: &PipelineVersion,
    effects: &[GraphEffect],
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
) -> Result<(Vec<Node>, Vec<Edge>), ResolveError> {
    let mut current = pipeline.clone();
    for effect in effects {
        let (nodes, edges) = apply_one(&current, effect, &operator_of)?;
        current.nodes = nodes;
        current.edges = edges;
    }
    Ok((current.nodes, current.edges))
}

fn apply_one<'a>(
    current: &PipelineVersion,
    effect: &GraphEffect,
    operator_of: &impl Fn(&str) -> Option<&'a Operator>,
) -> Result<(Vec<Node>, Vec<Edge>), ResolveError> {
    let refuse = |why: String| ResolveError::NotInsertable(why);
    match effect {
        GraphEffect::RemoveNode { node_id } => without_node(current, node_id.as_str()),
        GraphEffect::InsertNode {
            node_id,
            operator,
            params,
            before,
            other,
        } => {
            let step = parse(
                &json!({ "id": node_id, "operator": operator, "params": params }).to_string(),
            )?;
            let other = other.as_ref().map(|o| o.as_str());
            with_node_before(current, step, before.as_str(), other, operator_of)
        }
        GraphEffect::ReplaceNode {
            node_id,
            operator,
            params,
        } => {
            let mut nodes = current.nodes.clone();
            let node = nodes
                .iter_mut()
                .find(|n| n.id == *node_id)
                .ok_or_else(|| ResolveError::UnknownNode(node_id.to_string()))?;
            node.operator = operator.clone();
            node.params = params.clone();
            Ok((nodes, current.edges.clone()))
        }
        GraphEffect::AddNode {
            node_id,
            operator,
            params,
            inputs,
        } => {
            let id = node_id.as_str();
            if current.nodes.iter().any(|n| n.id == *node_id) {
                return Err(refuse(format!("a step named {id} already exists")));
            }
            let found = operator_of(operator.as_str())
                .ok_or_else(|| ResolveError::UnknownOperator(operator.to_string()))?;
            let mut edges = current.edges.clone();
            for (port, from) in inputs {
                let port = port.as_str();
                check_input(found, port)?;
                check_output(current, from, operator_of)?;
                edges.push(edge(from.as_str(), &format!("{id}.{port}"))?);
            }
            if let Some(unread) = found.inputs.iter().find(|p| {
                p.optional != Some(true) && !inputs.keys().any(|k| k.as_str() == p.name.as_str())
            }) {
                return Err(refuse(format!(
                    "{id} reads nothing on {}",
                    unread.name.as_str()
                )));
            }
            let mut nodes = current.nodes.clone();
            nodes.push(parse(
                &json!({ "id": id, "operator": operator, "params": params }).to_string(),
            )?);
            Ok((nodes, edges))
        }
        GraphEffect::SetInput {
            node_id,
            port,
            from,
        } => {
            let node = current
                .nodes
                .iter()
                .find(|n| n.id == *node_id)
                .ok_or_else(|| ResolveError::UnknownNode(node_id.to_string()))?;
            let found = operator_of(node.operator.as_str())
                .ok_or_else(|| ResolveError::UnknownOperator(node.operator.to_string()))?;
            check_input(found, port.as_str())?;
            check_output(current, from, operator_of)?;
            let to = format!("{}.{}", node_id.as_str(), port.as_str());
            let mut edges: Vec<Edge> = current
                .edges
                .iter()
                .filter(|e| e.to.as_str() != to)
                .cloned()
                .collect();
            edges.push(edge(from.as_str(), &to)?);
            Ok((current.nodes.clone(), edges))
        }
    }
}

fn check_input(operator: &Operator, port: &str) -> Result<(), ResolveError> {
    if operator.inputs.iter().any(|p| p.name.as_str() == port) {
        return Ok(());
    }
    Err(ResolveError::NotInsertable(format!(
        "{} has no input {port}",
        operator.id.as_str()
    )))
}

/// The output `from` names exists: its step is in the flow and its operator has that port.
fn check_output<'a>(
    current: &PipelineVersion,
    from: &PortRef,
    operator_of: &impl Fn(&str) -> Option<&'a Operator>,
) -> Result<(), ResolveError> {
    let (step, port) = from.step_and_port();
    let node = current
        .nodes
        .iter()
        .find(|n| n.id.as_str() == step)
        .ok_or_else(|| ResolveError::UnknownNode(step.to_owned()))?;
    let found = operator_of(node.operator.as_str())
        .ok_or_else(|| ResolveError::UnknownOperator(node.operator.to_string()))?;
    if found.outputs.iter().any(|p| p.name.as_str() == port) {
        return Ok(());
    }
    Err(ResolveError::NotInsertable(format!(
        "{step} has no output {port}"
    )))
}
