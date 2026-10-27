//! Methods and concepts (ADR-0063), loaded beside the old rules. A pack is refused at load
//! when a method needs something nothing provides, so no walk finds out halfway.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use petgraph::algo::toposort;
use petgraph::graph::DiGraph;
use serde_json::json;
use sprisk_contracts::{
    Concept, ConceptKind, ConceptSet, Method, MethodFiles, MethodInsert, MethodReplace, MethodSet,
    Operator, OperatorAttachSide, OperatorRole, OperatorScope,
};

use crate::catalog::{CatalogError, parse_yaml, read};
use sprisk_registry::evidence::EVIDENCE_PORT;

pub(crate) const METHOD: &str = "method.yaml";
pub(crate) const METHOD_MODULE: &str = "method.py";
pub(crate) const CONCEPTS: &str = "concepts.yaml";

#[derive(Debug)]
pub(crate) struct MethodEntry {
    pub method: Method,
    pub path: PathBuf,
    /// method.yaml and method.py as they loaded: the files shown are the files that run.
    pub files: MethodFiles,
}

#[derive(Debug)]
pub(crate) struct ConceptEntry {
    pub concept: Concept,
    pub path: PathBuf,
}

pub(crate) fn read_method(path: &Path) -> Result<MethodEntry, CatalogError> {
    let method: Method = parse_yaml(path)?;
    let module = path.with_file_name(METHOD_MODULE);
    if !module.is_file() {
        return Err(method_error(path, "a method needs its method.py"));
    }
    let files = json!({ "method": method.id, "files": [
        { "path": METHOD, "language": "yaml", "text": read(path)? },
        { "path": METHOD_MODULE, "language": "python", "text": read(&module)? },
    ] });
    let files =
        sprisk_contracts::parse(&files.to_string()).map_err(|source| CatalogError::Invalid {
            path: path.to_owned(),
            source,
        })?;
    Ok(MethodEntry {
        method,
        path: path.to_owned(),
        files,
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
        producer(&kind, &provided.operators).map_err(CatalogError::Evidence)?;
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
    // The engine reads what a producer measured from this one port.
    if !operator.produces.is_empty()
        && !operator
            .outputs
            .iter()
            .any(|p| p.name.as_str() == EVIDENCE_PORT)
    {
        return Err(refuse(format!(
            "produces evidence, so it needs an output named {EVIDENCE_PORT}"
        )));
    }
    // The engine adds a producer only where its manifest says it attaches. A select step is
    // never added by it: a comparison runs one, and the walk reads what it found there.
    if !operator.produces.is_empty()
        && operator.attach.is_none()
        && operator.role != Some(OperatorRole::Select)
    {
        return Err(refuse("produces evidence, so it needs an attach".into()));
    }
    // A producer on a split's outputs that reads the test rows is a look at them: it may read
    // their features, never their labels, except to name a column the worker drops (ADR-0064).
    let reads_test_rows = operator
        .attach
        .as_ref()
        .is_some_and(|a| a.role == OperatorRole::Split && a.side == OperatorAttachSide::Output)
        && operator.inputs.iter().any(|p| p.name.as_str() == "test");
    for (param, concept) in &operator.concepts {
        let found = known_concept(concept.as_str(), provided).map_err(refuse)?;
        let schema = param_schema(operator, param.as_str());
        let dropped = schema.and_then(|s| s.get("x-sprisk-excluded")) == Some(&json!(true));
        if reads_test_rows && found.kind == ConceptKind::Label && !dropped {
            return Err(refuse(format!(
                "reads the test rows, so it may not read the label {} ({})",
                concept.as_str(),
                param.as_str()
            )));
        }
        if schema.is_none() {
            return Err(refuse(format!(
                "maps {} to {}, which is not one of its params",
                concept.as_str(),
                param.as_str()
            )));
        }
        // An all-rows step runs before the split; reading the label there leaks it into every
        // row. Naming it as a column the worker drops first reads nothing.
        if operator.scope == Some(OperatorScope::All)
            && found.kind == ConceptKind::Label
            && !dropped
        {
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
        producer(kind.as_str(), &provided.operators).map_err(|p| format!("needs {p}"))?;
    }
    for verification in method.verifications.values() {
        producer(verification.needs.as_str(), &provided.operators)
            .map_err(|p| format!("verifies {p}"))?;
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
    // The data flow draws a step before the model in the lane of each input it changes.
    let before_model = method
        .options
        .iter()
        .filter_map(|o| o.action.as_ref()?.insert.as_ref())
        .any(|i| i.before == OperatorRole::Model);
    match (before_model, method.changes.is_some()) {
        (true, false) => {
            return Err(
                "inserts a step before the model, so it says which inputs it changes".into(),
            );
        }
        (false, true) => {
            return Err(
                "says which inputs it changes, but inserts no step before the model".into(),
            );
        }
        _ => {}
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
        let changes = action.bind.is_some()
            || action.replace.is_some()
            || action.insert.is_some()
            || action.set.is_some();
        if action.stop.is_some() && changes {
            return Err(in_option(
                "stops the walk, so it changes nothing in the flow".into(),
            ));
        }
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
        if let Some(insert) = &action.insert {
            check_insert(insert, method, provided).map_err(in_option)?;
        }
        if let Some(set) = &action.set {
            check_set(set, method, provided).map_err(in_option)?;
        }
    }
    Ok(())
}

/// Every operator with the role has every param the option sets, so the setting holds
/// whichever model a comparison picks, and each statement it reads is one the method needs.
fn check_set(set: &MethodSet, method: &Method, provided: &Provided) -> Result<(), String> {
    for (name, statement) in &set.from_statements {
        if !method.needs.statements.contains(statement) {
            return Err(format!(
                "sets {} from {statement}, which the method does not need",
                name.as_str()
            ));
        }
    }
    let named = set
        .settings
        .iter()
        .flat_map(|s| s.keys().map(String::as_str))
        .chain(set.from_statements.keys().map(|k| k.as_str()));
    let holders = provided
        .operators
        .values()
        .filter(|o| o.role == Some(set.role));
    for operator in holders {
        for name in named.clone() {
            if param_schema(operator, name).is_none() {
                return Err(format!("{} has no param {name}", operator.id.as_str()));
            }
        }
    }
    Ok(())
}

/// The operator is registered and has every param the option sets, and each param read from
/// evidence names a field of evidence the method needs.
fn check_insert(insert: &MethodInsert, method: &Method, provided: &Provided) -> Result<(), String> {
    let id = insert.operator.to_string();
    let operator = provided
        .operators
        .get(&id)
        .ok_or_else(|| format!("{id} is not registered"))?;
    let named = insert
        .settings
        .iter()
        .flat_map(|s| s.keys().map(String::as_str))
        .chain(insert.from_evidence.keys().map(|k| k.as_str()))
        .chain(insert.concepts.keys().map(|k| k.as_str()));
    for name in named {
        if param_schema(operator, name).is_none() {
            return Err(format!("{id} has no param {name}"));
        }
    }
    for (name, value) in insert.settings.iter().flat_map(|s| s.iter()) {
        if let Some(schema) = param_schema(operator, name)
            && !jsonschema::is_valid(schema, value)
        {
            return Err(format!("{id} does not accept {name} {value}"));
        }
    }
    for path in insert.from_evidence.values() {
        let path = path.as_str();
        // `<area>.<evidence>.<field>`: the schema checks the shape.
        let (kind, field) = path.rsplit_once('.').unwrap_or((path, ""));
        if !method.needs.evidence.iter().any(|k| k.as_str() == kind) {
            return Err(format!("reads {kind}, which the method does not need"));
        }
        let made = producer(kind, &provided.operators)?;
        let declared = made
            .produces
            .iter()
            .find(|(k, _)| k.as_str() == kind)
            .is_some_and(|(_, p)| p.fields.keys().any(|f| f.as_str() == field));
        if !declared {
            return Err(format!("{kind} has no field {field}"));
        }
    }
    for concept in insert.concepts.values() {
        known_concept(concept.as_str(), provided)?;
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
pub(crate) fn producer<'a>(
    kind: &str,
    operators: &BTreeMap<String, &'a Operator>,
) -> Result<&'a Operator, String> {
    let all: Vec<(&Operator, bool)> = operators
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

/// `producer`, as the walk's error: a pack that loaded has one for every kind it needs.
pub(crate) fn producer_of<'a>(
    kind: &str,
    operators: &BTreeMap<String, &'a Operator>,
) -> Result<&'a Operator, crate::ResolveError> {
    producer(kind, operators).map_err(|p| crate::ResolveError::Rules(CatalogError::Evidence(p)))
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
