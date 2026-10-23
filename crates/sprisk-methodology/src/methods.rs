//! Methods and concepts (ADR-0063), loaded beside the old rules. A pack is refused at load
//! when a method needs something nothing provides, so no walk finds out halfway.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use petgraph::algo::toposort;
use petgraph::graph::DiGraph;
use sprisk_contracts::{
    Concept, ConceptKind, ConceptSet, Method, MethodReplace, Operator, OperatorScope,
};

use crate::catalog::{CatalogError, parse_yaml};

pub(crate) const METHOD: &str = "method.yaml";
const METHOD_MODULE: &str = "method.py";
pub(crate) const CONCEPTS: &str = "concepts.yaml";

#[derive(Debug)]
pub(crate) struct MethodEntry {
    pub method: Method,
    pub path: PathBuf,
}

#[derive(Debug)]
pub(crate) struct ConceptEntry {
    pub concept: Concept,
    pub path: PathBuf,
}

pub(crate) fn read_method(path: &Path) -> Result<MethodEntry, CatalogError> {
    let method: Method = parse_yaml(path)?;
    if !path.with_file_name(METHOD_MODULE).is_file() {
        return Err(method_error(path, "a method needs its method.py"));
    }
    Ok(MethodEntry {
        method,
        path: path.to_owned(),
    })
}

/// Adds a pack's concepts to `concepts`; one concept has one definition.
pub(crate) fn read_concepts(
    path: &Path,
    concepts: &mut BTreeMap<String, ConceptEntry>,
) -> Result<(), CatalogError> {
    let set: ConceptSet = parse_yaml(path)?;
    for (id, concept) in set.concepts {
        let id = id.to_string();
        if let Some(first) = concepts.get(&id) {
            return Err(CatalogError::DuplicateConcept {
                id,
                first: first.path.clone(),
                second: path.to_owned(),
            });
        }
        let path = path.to_owned();
        concepts.insert(id, ConceptEntry { concept, path });
    }
    Ok(())
}

/// What a pack's methods may rely on: its concepts, the registered operators and the
/// decisions the old rules make.
pub(crate) struct Provided<'a> {
    pub concepts: &'a BTreeMap<String, ConceptEntry>,
    pub operators: BTreeMap<String, &'a Operator>,
    pub rule_decisions: BTreeSet<String>,
}

/// Refuses what no walk could satisfy, then returns the methods in decision order: a method
/// comes after every method whose decision it reads.
pub(crate) fn check(
    methods: Vec<MethodEntry>,
    provided: &Provided,
) -> Result<Vec<MethodEntry>, CatalogError> {
    for operator in provided.operators.values() {
        check_operator(operator, provided)?;
    }
    for kind in produced_kinds(provided) {
        producer(&kind, provided).map_err(CatalogError::Evidence)?;
    }
    let decided: BTreeSet<String> = methods
        .iter()
        .map(|m| m.method.decides.to_string())
        .chain(provided.rule_decisions.iter().cloned())
        .collect();
    for entry in &methods {
        check_method(&entry.method, provided, &decided)
            .map_err(|problem| method_error(&entry.path, &problem))?;
    }
    in_decision_order(methods)
}

fn check_operator(operator: &Operator, provided: &Provided) -> Result<(), CatalogError> {
    let refuse = |problem: String| CatalogError::Operator {
        operator: operator.id.to_string(),
        problem,
    };
    for (param, concept) in &operator.concepts {
        let found = known_concept(concept.as_str(), provided).map_err(refuse)?;
        if param_schema(operator, param.as_str()).is_none() {
            return Err(refuse(format!(
                "maps {} to {}, which is not one of its params",
                concept.as_str(),
                param.as_str()
            )));
        }
        // An all-rows step runs before the split; reading the label there leaks it into every row.
        if operator.scope == Some(OperatorScope::All) && found.kind == ConceptKind::Label {
            return Err(refuse(format!(
                "reads every row, so it may not read the label {} ({})",
                concept.as_str(),
                param.as_str()
            )));
        }
    }
    Ok(())
}

fn check_method(
    method: &Method,
    provided: &Provided,
    decided: &BTreeSet<String>,
) -> Result<(), String> {
    for concept in &method.needs.concepts {
        known_concept(concept.as_str(), provided)?;
    }
    for kind in &method.needs.evidence {
        producer(kind.as_str(), provided).map_err(|p| format!("needs {p}"))?;
    }
    for verification in method.verifications.values() {
        producer(verification.needs.as_str(), provided).map_err(|p| format!("verifies {p}"))?;
    }
    if let Some(read) = method
        .needs
        .decisions
        .iter()
        .find(|d| !decided.contains(d.as_str()))
    {
        return Err(format!(
            "reads decision {}, which no method or rule makes",
            read.as_str()
        ));
    }
    for option in &method.options {
        let in_option = |p: String| format!("option {}: {p}", option.id.as_str());
        if let Some(name) = option.verify.iter().find(|v| {
            !method
                .verifications
                .keys()
                .any(|k| k.as_str() == v.as_str())
        }) {
            return Err(in_option(format!(
                "promises {}, which the method does not declare",
                name.as_str()
            )));
        }
        let Some(action) = &option.action else {
            continue;
        };
        if let Some(bind) = &action.bind {
            known_concept(bind.concept.as_str(), provided).map_err(in_option)?;
            if !method.needs.evidence.contains(&bind.evidence) {
                return Err(in_option(format!(
                    "binds from {}, which the method does not need",
                    bind.evidence.as_str()
                )));
            }
        }
        if let Some(replace) = &action.replace {
            check_replace(replace, provided).map_err(in_option)?;
        }
    }
    Ok(())
}

/// The operator is registered, has the role it replaces, and has every param the option sets.
fn check_replace(replace: &MethodReplace, provided: &Provided) -> Result<(), String> {
    let id = replace.operator.to_string();
    let operator = provided
        .operators
        .get(&id)
        .ok_or_else(|| format!("{id} is not registered"))?;
    if operator.role != Some(replace.role) {
        return Err(format!("{id} does not have the role {}", replace.role));
    }
    // Each value is checked alone: the engine fills params such as the target, so a whole
    // params object is complete only when the step is built.
    for (name, value) in replace.settings.iter().flat_map(|s| s.iter()) {
        let schema =
            param_schema(operator, name).ok_or_else(|| format!("{id} has no param {name}"))?;
        if !jsonschema::is_valid(schema, value) {
            return Err(format!("{id} does not accept {name} {value}"));
        }
    }
    if let Some(missing) = replace
        .concepts
        .keys()
        .find(|name| param_schema(operator, name.as_str()).is_none())
    {
        return Err(format!("{id} has no param {}", missing.as_str()));
    }
    for (param, concept) in &replace.concepts {
        known_concept(concept.as_str(), provided)?;
        // One place says which concept fills a param, so the two cannot drift apart.
        if operator
            .concepts
            .keys()
            .any(|k| k.as_str() == param.as_str())
        {
            return Err(format!(
                "maps {}, which its operator already maps",
                param.as_str()
            ));
        }
    }
    Ok(())
}

/// The JSON Schema of one of the operator's params; None when it has no such param.
fn param_schema<'a>(operator: &'a Operator, name: &str) -> Option<&'a serde_json::Value> {
    operator.params_schema.get("properties")?.get(name)
}

fn known_concept<'a>(id: &str, provided: &'a Provided) -> Result<&'a Concept, String> {
    provided
        .concepts
        .get(id)
        .map(|e| &e.concept)
        .ok_or_else(|| format!("unknown concept {id}"))
}

fn produced_kinds(provided: &Provided) -> BTreeSet<String> {
    provided
        .operators
        .values()
        .flat_map(|op| op.produces.keys().map(|k| k.to_string()))
        .collect()
}

/// The one operator the engine adds to produce `kind`: its only producer, or the default.
fn producer<'a>(kind: &str, provided: &Provided<'a>) -> Result<&'a Operator, String> {
    let all: Vec<(&Operator, bool)> = provided
        .operators
        .values()
        .filter_map(|op| {
            let (_, made) = op.produces.iter().find(|(k, _)| k.as_str() == kind)?;
            Some((*op, made.default == Some(true)))
        })
        .collect();
    let defaults: Vec<&Operator> = all.iter().filter(|(_, d)| *d).map(|(op, _)| *op).collect();
    let ids = |ops: &[&Operator]| {
        ops.iter()
            .map(|o| o.id.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    };
    match (all.as_slice(), defaults.as_slice()) {
        ([], _) => Err(format!("{kind}: no operator produces it")),
        ([(only, _)], _) | (_, [only]) => Ok(only),
        (_, []) => {
            let producers: Vec<&Operator> = all.iter().map(|(op, _)| *op).collect();
            Err(format!(
                "{kind}: produced by {}, and none is the default",
                ids(&producers)
            ))
        }
        (_, _) => Err(format!("{kind}: several defaults: {}", ids(&defaults))),
    }
}

fn in_decision_order(methods: Vec<MethodEntry>) -> Result<Vec<MethodEntry>, CatalogError> {
    let mut graph = DiGraph::<usize, ()>::new();
    let nodes: Vec<_> = (0..methods.len()).map(|i| graph.add_node(i)).collect();
    for (reader, entry) in methods.iter().enumerate() {
        for read in &entry.method.needs.decisions {
            if let Some(maker) = methods.iter().position(|m| &m.method.decides == read) {
                graph.add_edge(nodes[maker], nodes[reader], ());
            }
        }
    }
    let order = toposort(&graph, None).map_err(|cycle| {
        CatalogError::DecisionCycle(methods[graph[cycle.node_id()]].method.id.to_string())
    })?;
    let mut slots: Vec<Option<MethodEntry>> = methods.into_iter().map(Some).collect();
    Ok(order
        .into_iter()
        .filter_map(|node| slots[graph[node]].take())
        .collect())
}

fn method_error(path: &Path, problem: &str) -> CatalogError {
    CatalogError::Method {
        path: path.to_owned(),
        problem: problem.to_owned(),
    }
}
