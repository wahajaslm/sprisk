//! The evidence methods need (ADR-0063): the engine adds each kind's producer where its
//! manifest `attach`es, fills its concept params from the question's bindings, and moves it
//! back onto those rows when a step is added before the step it attaches to. It says so as
//! a patch, which the caller applies with `patch::apply`.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};
use sprisk_contracts::{
    Binding, GraphEffect, Method, Operator, OperatorAttachSide, PipelineVersion, QuestionVersion,
    TaskType, parse,
};

use crate::compare::upstream;
use crate::decision::free_id;
use crate::{ResolveError, RuleCatalog, methods, patch};

/// The patch that puts every needed producer in place.
#[derive(Debug)]
pub struct Measuring {
    /// Empty: the flow already measures what is needed.
    pub effects: Vec<GraphEffect>,
    /// What the effects do, one sentence each.
    pub changes: Vec<String>,
    /// Producers left out, and why: a concept they read is unbound, or the flow has no one
    /// step where they attach.
    pub left_out: Vec<String>,
}

/// Places the producers of the evidence that the methods fitting `question` need.
pub fn measure(
    catalog: &RuleCatalog,
    pipeline: &PipelineVersion,
    question: &QuestionVersion,
    bindings: &[Binding],
    operators: &[Operator],
) -> Result<Measuring, ResolveError> {
    let by_id: BTreeMap<String, &Operator> =
        operators.iter().map(|o| (o.id.to_string(), o)).collect();
    let mut placing = Placing {
        flow: pipeline.clone(),
        operators: &by_id,
        measuring: Measuring {
            effects: Vec::new(),
            changes: Vec::new(),
            left_out: Vec::new(),
        },
    };
    for method in fitting(catalog, question.task.value) {
        for kind in &method.needs.evidence {
            let producer = methods::producer_of(kind.as_str(), &by_id)?;
            let need = format!("{} needs {}", method.decides.as_str(), kind.as_str());
            match bound_params(producer, bindings) {
                Ok(params) => {
                    if let Some(why) = placing.place(producer, params, &need)? {
                        placing
                            .measuring
                            .left_out
                            .push(format!("{need}, but {why}."));
                    }
                }
                Err(concept) => {
                    let description = catalog
                        .concepts()
                        .find(|(id, _)| *id == concept)
                        .map_or("", |(_, c)| c.description.as_str());
                    placing.measuring.left_out.push(format!(
                        "{} needs {concept} ({description}): state which column holds it, if one does.",
                        method.decides.as_str()
                    ));
                }
            }
        }
    }
    Ok(placing.measuring)
}

/// The methods that apply to a question of `task`, in decision order.
pub fn fitting(catalog: &RuleCatalog, task: TaskType) -> impl Iterator<Item = &Method> {
    catalog.methods().filter(move |m| {
        m.applies_when
            .as_ref()
            .is_none_or(|w| w.task.contains(&task))
    })
}

/// The producer's concept params, each the column `bindings` binds to its concept; the
/// first unbound concept otherwise.
fn bound_params(producer: &Operator, bindings: &[Binding]) -> Result<Value, String> {
    let mut params = Map::new();
    for (param, concept) in &producer.concepts {
        let binding = bindings
            .iter()
            .find(|b| b.concept == *concept)
            .ok_or_else(|| concept.to_string())?;
        params.insert(param.to_string(), json!(binding.source.column));
    }
    Ok(Value::Object(params))
}

/// The patch so far, and the flow as it would stand with it, so a later producer is placed
/// on what an earlier one left.
struct Placing<'o> {
    flow: PipelineVersion,
    operators: &'o BTreeMap<String, &'o Operator>,
    measuring: Measuring,
}

impl Placing<'_> {
    /// Puts `producer` where it attaches, or moves it back there. Some(why) when the flow
    /// has no one place for it: the producer is left out and the walk goes on.
    fn place(
        &mut self,
        producer: &Operator,
        params: Value,
        need: &str,
    ) -> Result<Option<String>, ResolveError> {
        let id = producer.id.as_str();
        let attach = producer.attach.as_ref().ok_or_else(|| {
            ResolveError::NotInsertable(format!("{id} produces evidence but has no attach"))
        })?;
        // Slice 4 adds producers that read a step's outputs, with the verifications needing them.
        if attach.side == OperatorAttachSide::Output {
            return Ok(Some(format!(
                "{id} reads a step's outputs, which the engine does not place yet"
            )));
        }
        let role = attach.role;
        let anchors: Vec<String> = self
            .flow
            .nodes
            .iter()
            .filter(|n| {
                self.operators
                    .get(n.operator.as_str())
                    .is_some_and(|o| o.role == Some(role))
            })
            .map(|n| n.id.to_string())
            .collect();
        // ADR-0063: placement by role assumes one step per role.
        let anchor = match anchors.as_slice() {
            [one] => one.clone(),
            [] => return Ok(Some(format!("no step has the role {role}"))),
            _ => return Ok(Some(format!("several steps have the role {role}"))),
        };
        // Each input of the producer reads what the anchor reads on the input of that name.
        let mut wanted = BTreeMap::new();
        for port in producer.inputs.iter().map(|p| p.name.as_str()) {
            let Some(feeding) = self
                .flow
                .edges
                .iter()
                .find(|e| e.to.step_and_port() == (anchor.as_str(), port))
            else {
                return Ok(Some(format!("{anchor} reads nothing on {port}")));
            };
            wanted.insert(port.to_owned(), feeding.from.to_string());
        }

        let Some(placed) = self.flow.nodes.iter().find(|n| n.operator == producer.id) else {
            let name = id
                .split('@')
                .next()
                .and_then(|n| n.rsplit('.').next())
                .unwrap_or(id);
            let step = free_id(&self.flow.nodes, name);
            let added = json!({ "kind": "add_node", "node_id": step, "operator": id,
                                "params": params, "inputs": wanted });
            let change = format!("Adds {step} on the rows {anchor} reads: {need}.");
            return self.add(added, change).map(|()| None);
        };
        let step = placed.id.to_string();
        // The anchor reads rows that passed through the producer: it already sits on them, and
        // moving it onto what the anchor reads would make a cycle.
        let feeds_anchor = upstream(&self.flow, &anchor).contains(step.as_str());
        let moves: Vec<Value> = if feeds_anchor {
            Vec::new()
        } else {
            wanted
            .iter()
            .filter(|(port, from)| {
                let reads = self
                    .flow
                    .edges
                    .iter()
                    .find(|e| e.to.step_and_port() == (step.as_str(), port.as_str()));
                reads.is_none_or(|e| e.from.as_str() != from.as_str())
            })
            .map(|(port, from)| {
                json!({ "kind": "set_input", "node_id": step, "port": port, "from": from })
            })
            .collect()
        };
        let reset = serde_json::to_value(&placed.params)? != params;
        for moved in moves {
            let change = format!("Moves {step} onto the rows {anchor} reads now.");
            self.add(moved, change)?;
        }
        if reset {
            let replaced = json!({ "kind": "replace_node", "node_id": step, "operator": id,
                                   "params": params });
            let change = format!("Sets {step}'s columns from the question's bindings.");
            self.add(replaced, change)?;
        }
        Ok(None)
    }

    /// Adds one effect to the patch and applies it to the working flow.
    fn add(&mut self, effect: Value, change: String) -> Result<(), ResolveError> {
        let effect: GraphEffect = parse(&effect.to_string())?;
        let operators = self.operators;
        let (nodes, edges) = patch::apply(&self.flow, std::slice::from_ref(&effect), |o| {
            operators.get(o).copied()
        })?;
        self.flow.nodes = nodes;
        self.flow.edges = edges;
        self.measuring.effects.push(effect);
        if !self.measuring.changes.contains(&change) {
            self.measuring.changes.push(change);
        }
        Ok(())
    }
}
