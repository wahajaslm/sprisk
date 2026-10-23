//! The evidence methods need (ADR-0063): the engine adds each kind's producer where its
//! manifest `attach`es, fills its concept params from the question's bindings, and moves it
//! back onto those rows when a step is added before the step it attaches to.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};
use sprisk_contracts::{
    Edge, Method, Node, Operator, OperatorAttachSide, PipelineVersion, QuestionVersion, parse,
};

use crate::compare::edge;
use crate::{CatalogError, ResolveError, RuleCatalog, methods};

/// The flow with every needed producer in place.
#[derive(Debug)]
pub struct Measuring {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    /// What changed, one sentence each. Empty: the flow already measures what is needed.
    pub changes: Vec<String>,
    /// Producers left out because the question binds no column to a concept they read.
    pub unbound: Vec<String>,
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
        unbound: Vec::new(),
    };
    let task = question.task.value;
    let fits = |m: &&Method| {
        m.applies_when
            .as_ref()
            .is_none_or(|w| w.task.contains(&task))
    };
    for method in catalog.methods().filter(fits) {
        for kind in &method.needs.evidence {
            let producer = methods::producer(kind.as_str(), &by_id)
                .map_err(|p| ResolveError::Rules(CatalogError::Evidence(p)))?;
            let need = format!("{} needs {}", method.decides.as_str(), kind.as_str());
            match bound_params(producer, question) {
                Ok(params) => measuring.place(producer, params, &by_id, &need)?,
                Err(concept) => {
                    let description = catalog
                        .concepts()
                        .find(|(id, _)| *id == concept)
                        .map_or("", |(_, c)| c.description.as_str());
                    measuring.unbound.push(format!(
                        "{} needs {concept} ({description}): state which column holds it, if one does.",
                        method.decides.as_str()
                    ));
                }
            }
        }
    }
    Ok(measuring)
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
    fn place(
        &mut self,
        producer: &Operator,
        params: Value,
        operators: &BTreeMap<String, &Operator>,
        need: &str,
    ) -> Result<(), ResolveError> {
        let refuse = |why: String| ResolveError::NotInsertable(why);
        let id = producer.id.as_str();
        let attach = producer
            .attach
            .as_ref()
            .ok_or_else(|| refuse(format!("{id} produces evidence but has no attach")))?;
        let role = attach.role;
        let anchors: Vec<String> = self
            .nodes
            .iter()
            .filter(|n| {
                operators
                    .get(n.operator.as_str())
                    .is_some_and(|o| o.role == Some(role))
            })
            .map(|n| n.id.to_string())
            .collect();
        // ADR-0063: placement by role assumes one step per role.
        let anchor = match anchors.as_slice() {
            [one] => one.clone(),
            [] => return Err(refuse(format!("no step has the role {role}"))),
            _ => return Err(refuse(format!("several steps have the role {role}"))),
        };
        let (side, mut wanted) = (attach.side, BTreeSet::new());
        for port in producer.inputs.iter().map(|p| p.name.as_str()) {
            let from = match side {
                OperatorAttachSide::Input => self
                    .edges
                    .iter()
                    .find(|e| e.to.step_and_port() == (anchor.as_str(), port))
                    .map(|e| e.from.to_string())
                    .ok_or_else(|| refuse(format!("{anchor} reads nothing on {port}")))?,
                OperatorAttachSide::Output => format!("{anchor}.{port}"),
            };
            wanted.insert((from, port.to_owned()));
        }
        let rows = match side {
            OperatorAttachSide::Input => "reads",
            OperatorAttachSide::Output => "writes",
        };

        let Some(at) = self.nodes.iter().position(|n| n.operator == producer.id) else {
            let step = self.free_id(id);
            self.nodes.push(parse(
                &json!({ "id": step, "operator": id, "params": params }).to_string(),
            )?);
            for (from, port) in &wanted {
                self.edges.push(edge(from, &format!("{step}.{port}"))?);
            }
            self.changes
                .push(format!("Adds {step} on the rows {anchor} {rows}: {need}."));
            return Ok(());
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
                .push(format!("Moves {step} onto the rows {anchor} {rows} now."));
        }
        if serde_json::to_value(&self.nodes[at].params)? != params {
            self.nodes[at].params = parse(&params.to_string())?;
            self.changes.push(format!(
                "Sets {step}'s columns from the question's bindings."
            ));
        }
        Ok(())
    }

    /// The operator's name, as `near_duplicates` for `sprisk.profile.near_duplicates@1.0.0`,
    /// with a number added when a step already has that id.
    fn free_id(&self, operator: &str) -> String {
        let name = operator
            .split('@')
            .next()
            .and_then(|n| n.rsplit('.').next())
            .unwrap_or(operator);
        let taken = |id: &str| self.nodes.iter().any(|n| n.id.as_str() == id);
        (1..)
            .map(|i| {
                if i == 1 {
                    name.to_owned()
                } else {
                    format!("{name}_{i}")
                }
            })
            .find(|id| !taken(id))
            .unwrap_or_else(|| name.to_owned())
    }
}
