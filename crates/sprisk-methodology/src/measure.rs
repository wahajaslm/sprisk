//! The evidence methods need (ADR-0063): the engine adds each kind's producer where its
//! manifest `attach`es, fills its concept params from the question's bindings, and moves it
//! back onto those rows when a step is added before the step it attaches to.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};
use sprisk_contracts::{
    Edge, Method, Node, Operator, OperatorAttachSide, PipelineVersion, QuestionVersion, TaskType,
    parse,
};

use crate::compare::edge;
use crate::decision::free_id;
use crate::{CatalogError, ResolveError, RuleCatalog, methods};

/// The flow with every needed producer in place.
#[derive(Debug)]
pub struct Measuring {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    /// What changed, one sentence each. Empty: the flow already measures what is needed.
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
    operators: &[Operator],
) -> Result<Measuring, ResolveError> {
    let by_id: BTreeMap<String, &Operator> =
        operators.iter().map(|o| (o.id.to_string(), o)).collect();
    let mut measuring = Measuring {
        nodes: pipeline.nodes.clone(),
        edges: pipeline.edges.clone(),
        changes: Vec::new(),
        left_out: Vec::new(),
    };
    for method in fitting(catalog, question.task.value) {
        for kind in &method.needs.evidence {
            let producer = methods::producer(kind.as_str(), &by_id)
                .map_err(|p| ResolveError::Rules(CatalogError::Evidence(p)))?;
            let need = format!("{} needs {}", method.decides.as_str(), kind.as_str());
            match bound_params(producer, question) {
                Ok(params) => {
                    if let Some(why) = measuring.place(producer, params, &by_id, &need)? {
                        measuring.left_out.push(format!("{need}, but {why}."));
                    }
                }
                Err(concept) => {
                    let description = catalog
                        .concepts()
                        .find(|(id, _)| *id == concept)
                        .map_or("", |(_, c)| c.description.as_str());
                    measuring.left_out.push(format!(
                        "{} needs {concept} ({description}): state which column holds it, if one does.",
                        method.decides.as_str()
                    ));
                }
            }
        }
    }
    Ok(measuring)
}

/// The methods that apply to a question of `task`, in decision order.
pub fn fitting(catalog: &RuleCatalog, task: TaskType) -> impl Iterator<Item = &Method> {
    catalog.methods().filter(move |m| {
        m.applies_when
            .as_ref()
            .is_none_or(|w| w.task.contains(&task))
    })
}

/// The producer's concept params, each the column the question binds to its concept; the
/// first unbound concept otherwise.
fn bound_params(producer: &Operator, question: &QuestionVersion) -> Result<Value, String> {
    let mut params = Map::new();
    for (param, concept) in &producer.concepts {
        let binding = question
            .bindings
            .iter()
            .find(|b| b.concept == *concept)
            .ok_or_else(|| concept.to_string())?;
        params.insert(param.to_string(), json!(binding.source.column));
    }
    Ok(Value::Object(params))
}

impl Measuring {
    /// Puts `producer` where it attaches, or moves it back there. Some(why) when the flow
    /// has no one place for it: the producer is left out and the walk goes on.
    fn place(
        &mut self,
        producer: &Operator,
        params: Value,
        operators: &BTreeMap<String, &Operator>,
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
        let anchors: Vec<&Node> = self
            .nodes
            .iter()
            .filter(|n| {
                operators
                    .get(n.operator.as_str())
                    .is_some_and(|o| o.role == Some(role))
            })
            .collect();
        // ADR-0063: placement by role assumes one step per role.
        let anchor = match anchors.as_slice() {
            [one] => one.id.to_string(),
            [] => return Ok(Some(format!("no step has the role {role}"))),
            _ => return Ok(Some(format!("several steps have the role {role}"))),
        };
        let mut wanted = BTreeSet::new();
        for port in producer.inputs.iter().map(|p| p.name.as_str()) {
            let Some(from) = self
                .edges
                .iter()
                .find(|e| e.to.step_and_port() == (anchor.as_str(), port))
            else {
                return Ok(Some(format!("{anchor} reads nothing on {port}")));
            };
            wanted.insert((from.from.to_string(), port.to_owned()));
        }

        let Some(at) = self.nodes.iter().position(|n| n.operator == producer.id) else {
            let name = id
                .split('@')
                .next()
                .and_then(|n| n.rsplit('.').next())
                .unwrap_or(id);
            let step = free_id(&self.nodes, name);
            self.nodes.push(parse(
                &json!({ "id": step, "operator": id, "params": params }).to_string(),
            )?);
            for (from, port) in &wanted {
                self.edges.push(edge(from, &format!("{step}.{port}"))?);
            }
            self.changes
                .push(format!("Adds {step} on the rows {anchor} reads: {need}."));
            return Ok(None);
        };
        let step = self.nodes[at].id.to_string();
        let reads: BTreeSet<(String, String)> = self
            .edges
            .iter()
            .filter(|e| e.to.step_and_port().0 == step)
            .map(|e| (e.from.to_string(), e.to.step_and_port().1.to_owned()))
            .collect();
        if reads != wanted {
            self.edges.retain(|e| e.to.step_and_port().0 != step);
            for (from, port) in &wanted {
                self.edges.push(edge(from, &format!("{step}.{port}"))?);
            }
            self.changes
                .push(format!("Moves {step} onto the rows {anchor} reads now."));
        }
        if serde_json::to_value(&self.nodes[at].params)? != params {
            self.nodes[at].params = parse(&params.to_string())?;
            self.changes.push(format!(
                "Sets {step}'s columns from the question's bindings."
            ));
        }
        Ok(None)
    }
}
