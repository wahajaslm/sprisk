//! What methods decide in a walk (ADR-0063 slice 4 and its amendment). Pure: which methods
//! are ready, what each may read, and the bindings and patch its option makes. The API runs
//! decide() in Python and applies the patch.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};
use sprisk_contracts::{
    Binding, GraphEffect, Method, MethodAssurance, MethodRequest, Operator, PipelineVersion,
    QuestionVersion, WalkAsk, parse,
};

use crate::measure::fitting;
use crate::{CatalogError, ResolveError, RuleCatalog, methods, patch};

/// The question facts that act as bindings until slice 6 removes the fixed facts: a stated
/// or confirmed one binds its concept; a guessed one is asked first (ADR-0059).
const FACT_CONCEPTS: [(&str, &str); 3] = [
    ("target", "common.target"),
    ("time_column", "common.event_time"),
    ("entity_column", "common.item_identity"),
];

/// A decision the walk already made: from one of its decide steps.
#[derive(Debug, Clone)]
pub struct Made {
    pub decides: String,
    pub option: String,
    pub bindings: Vec<Binding>,
}

/// Which source means each concept in this walk, and the concepts only a guess names.
#[derive(Debug)]
pub struct Effective {
    pub bindings: Vec<Binding>,
    /// Concept to the question fact that guesses it.
    pub guesses: BTreeMap<String, String>,
}

/// The question's bindings, then its stated facts, then the bindings decisions made. A later
/// one for the same concept takes the place of an earlier one.
pub fn bindings(question: &QuestionVersion, made: &[Made]) -> Result<Effective, ResolveError> {
    let mut effective = Effective {
        bindings: question.bindings.clone(),
        guesses: BTreeMap::new(),
    };
    let facts = serde_json::to_value(question)?;
    for (fact, concept) in FACT_CONCEPTS {
        if effective
            .bindings
            .iter()
            .any(|b| b.concept.as_str() == concept)
        {
            continue;
        }
        let Some(stated) = facts.get(fact) else {
            continue;
        };
        if stated["origin"] == "inferred" {
            effective
                .guesses
                .insert(concept.to_owned(), fact.to_owned());
            continue;
        }
        effective.bindings.push(parse(
            &json!({ "schema_version": "sprisk.binding/v1", "concept": concept,
                     "source": { "column": stated["value"] },
                     "set_by": { "assurance": "stated" } })
            .to_string(),
        )?);
    }
    for binding in made.iter().flat_map(|m| &m.bindings) {
        effective.bindings.retain(|b| b.concept != binding.concept);
        effective.bindings.push(binding.clone());
    }
    Ok(effective)
}

/// A method that can decide now, and the one request its decide() reads.
#[derive(Debug)]
pub struct Ready<'c> {
    pub method: &'c Method,
    pub request: MethodRequest,
}

#[derive(Debug)]
pub struct Readiness<'c> {
    /// In decision order.
    pub ready: Vec<Ready<'c>>,
    /// Guessed facts a method reads, to confirm before it decides.
    pub asks: Vec<WalkAsk>,
}

/// The methods fitting the question that are not decided yet and can decide: every decision
/// they read is made, no concept they read is only a guess, and each evidence kind they need
/// is in `measured` or cannot be measured (its producer reads an unbound concept). One whose
/// evidence can be measured but is not yet waits for the walk to measure it.
pub fn ready<'c>(
    catalog: &'c RuleCatalog,
    question: &QuestionVersion,
    made: &[Made],
    effective: &Effective,
    measured: &BTreeMap<String, Value>,
    operators: &[Operator],
) -> Result<Readiness<'c>, ResolveError> {
    let by_id: BTreeMap<String, &Operator> =
        operators.iter().map(|o| (o.id.to_string(), o)).collect();
    let decided: BTreeMap<&str, &str> = made
        .iter()
        .map(|m| (m.decides.as_str(), m.option.as_str()))
        .collect();
    let bound: BTreeSet<&str> = effective
        .bindings
        .iter()
        .map(|b| b.concept.as_str())
        .collect();
    let mut found = Readiness {
        ready: Vec::new(),
        asks: Vec::new(),
    };
    'methods: for method in fitting(catalog, question.task.value) {
        if decided.contains_key(method.decides.as_str()) {
            continue;
        }
        let mut decisions = Map::new();
        for key in &method.needs.decisions {
            let Some(option) = decided.get(key.as_str()) else {
                continue 'methods;
            };
            decisions.insert(key.to_string(), json!(option));
        }
        let guessed: Vec<&String> = method
            .needs
            .concepts
            .iter()
            .filter_map(|c| effective.guesses.get(c.as_str()))
            .collect();
        if !guessed.is_empty() {
            for fact in guessed {
                found.asks.push(guess_ask(method, fact)?);
            }
            continue;
        }
        let mut evidence = Map::new();
        for kind in &method.needs.evidence {
            if let Some(fields) = measured.get(kind.as_str()) {
                evidence.insert(kind.to_string(), fields.clone());
                continue;
            }
            let producer = methods::producer(kind.as_str(), &by_id)
                .map_err(|p| ResolveError::Rules(CatalogError::Evidence(p)))?;
            if producer
                .concepts
                .values()
                .all(|c| bound.contains(c.as_str()))
            {
                continue 'methods;
            }
        }
        let module = catalog.method_module(method.id.as_str())?;
        let needed_bound: Vec<&str> = method
            .needs
            .concepts
            .iter()
            .map(|c| c.as_str())
            .filter(|c| bound.contains(c))
            .collect();
        let options: Vec<&str> = method.options.iter().map(|o| o.id.as_str()).collect();
        let request = parse(
            &json!({
                "schema_version": "sprisk.method_request/v1",
                "module": module.display().to_string(), "method": method.id,
                "needs": method.needs, "options": options, "task": question.task.value,
                "evidence": evidence, "decisions": decisions, "bound": needed_bound,
            })
            .to_string(),
        )?;
        found.ready.push(Ready { method, request });
    }
    Ok(found)
}

fn guess_ask(method: &Method, fact: &str) -> Result<WalkAsk, ResolveError> {
    Ok(parse(
        &json!({
            "decides": format!("question.{fact}"),
            "question": format!(
                "The {} is still a guess: confirm it, or remove it if no column holds it. {}",
                fact.replace('_', " "),
                method.question.as_str()
            ),
        })
        .to_string(),
    )?)
}

/// What an option does once taken.
#[derive(Debug)]
pub struct Applied {
    /// The patch; empty when the option changes no step.
    pub effects: Vec<GraphEffect>,
    /// The bindings it made.
    pub bindings: Vec<Binding>,
    /// The verifications it promises.
    pub promises: Vec<String>,
}

/// The bindings and patch of `option` on `pipeline`. A param a concept fills reads its
/// binding's column; a column a step adds makes the replaced step read that step's output
/// of the same name. The patch is checked against the flow before it is returned.
pub fn apply_option(
    method: &Method,
    option: &str,
    assurance: MethodAssurance,
    effective: &[Binding],
    pipeline: &PipelineVersion,
    operators: &[Operator],
) -> Result<Applied, ResolveError> {
    let taken = method
        .options
        .iter()
        .find(|o| o.id.as_str() == option)
        .ok_or_else(|| ResolveError::UndeclaredOption {
            method: method.id.to_string(),
            option: option.to_owned(),
        })?;
    let by_id: BTreeMap<String, &Operator> =
        operators.iter().map(|o| (o.id.to_string(), o)).collect();
    let mut applied = Applied {
        effects: Vec::new(),
        bindings: Vec::new(),
        promises: taken.verify.iter().map(|v| v.to_string()).collect(),
    };
    let Some(action) = &taken.action else {
        return Ok(applied);
    };
    if let Some(bind) = &action.bind {
        let producer = methods::producer(bind.evidence.as_str(), &by_id)
            .map_err(|p| ResolveError::Rules(CatalogError::Evidence(p)))?;
        let step = one_step(
            pipeline,
            |n| n.operator == producer.id,
            producer.id.as_str(),
        )?;
        applied.bindings.push(parse(
            &json!({ "schema_version": "sprisk.binding/v1", "concept": bind.concept,
                     "source": { "column": bind.column, "step": step },
                     "set_by": { "assurance": assurance, "method": method.id } })
            .to_string(),
        )?);
    }
    if let Some(replace) = &action.replace {
        let operator = by_id
            .get(replace.operator.as_str())
            .ok_or_else(|| ResolveError::UnknownOperator(replace.operator.to_string()))?;
        let role = replace.role;
        let step = one_step(
            pipeline,
            |n| {
                by_id
                    .get(n.operator.as_str())
                    .is_some_and(|o| o.role == Some(role))
            },
            &format!("the role {role}"),
        )?;
        let mut params: Map<String, Value> = replace
            .settings
            .iter()
            .flat_map(|s| s.iter())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let concepts = replace
            .concepts
            .iter()
            .map(|(p, c)| (p.to_string(), c.to_string()))
            .chain(
                operator
                    .concepts
                    .iter()
                    .map(|(p, c)| (p.to_string(), c.to_string())),
            );
        let mut reads = BTreeSet::new();
        for (param, concept) in concepts {
            // An unbound concept leaves its param out; compiling refuses a required one.
            let Some(binding) = effective
                .iter()
                .chain(&applied.bindings)
                .find(|b| b.concept.as_str() == concept)
            else {
                continue;
            };
            params.insert(param, json!(binding.source.column));
            if let Some(adds) = &binding.source.step {
                reads.insert(adds.to_string());
            }
        }
        applied.effects.push(parse(
            &json!({ "kind": "replace_node", "node_id": step, "operator": operator.id,
                     "params": params })
            .to_string(),
        )?);
        for adds in reads {
            let adder = pipeline
                .nodes
                .iter()
                .find(|n| n.id.as_str() == adds)
                .and_then(|n| by_id.get(n.operator.as_str()))
                .ok_or_else(|| ResolveError::UnknownNode(adds.clone()))?;
            for port in operator.inputs.iter().map(|p| p.name.as_str()) {
                if adder.outputs.iter().any(|o| o.name.as_str() == port) {
                    applied.effects.push(parse(
                        &json!({ "kind": "set_input", "node_id": step, "port": port,
                                 "from": format!("{adds}.{port}") })
                        .to_string(),
                    )?);
                }
            }
        }
    }
    patch::apply(pipeline, &applied.effects, |o| by_id.get(o).copied())?;
    Ok(applied)
}

/// The id of the one step `matches` picks; refused when none or several do.
fn one_step(
    pipeline: &PipelineVersion,
    matches: impl Fn(&sprisk_contracts::Node) -> bool,
    what: &str,
) -> Result<String, ResolveError> {
    let found: Vec<&str> = pipeline
        .nodes
        .iter()
        .filter(|n| matches(n))
        .map(|n| n.id.as_str())
        .collect();
    match found.as_slice() {
        [one] => Ok((*one).to_owned()),
        [] => Err(ResolveError::NotInsertable(format!("no step runs {what}"))),
        _ => Err(ResolveError::NotInsertable(format!(
            "several steps run {what}: {}",
            found.join(", ")
        ))),
    }
}
