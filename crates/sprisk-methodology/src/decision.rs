//! The Rust half of a rule (ADR-0042): what its Python `decide()` reads, and the proposal
//! built from what it returns. Python chooses; Rust builds graph effects only from the
//! manifest's actions, so a rule can never name an operator its manifest does not declare.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use petgraph::graph::DiGraph;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sprisk_contracts::{
    BaselineRole, CapabilityClass, DatasetProfile, DecisionProposal, Edge, KeyMatches,
    MethodologyRule, MethodologyRuleSelection, Node, Operator, OperatorModel, PipelineVersion,
    PortRef, QuestionVersion, RuleActionType, RuleDecision,
    RuleDecisionAlternativesItemApplicability, RuleObservation, SelectionDecision, TaskType, parse,
};

use crate::compare::edge;

/// The scale step's operator, without version.
const SCALE: &str = "sprisk.clean.scale@";
use crate::{ResolveError, facts};

/// The rule's observation of this question, of the flow around the step (`flow_facts`)
/// and, for rules that read data, of the step's train rows (`profile_facts`), holding only
/// the facts the rule `reads` (ADR-0045). Its settings are the manifest's thresholds.
pub fn observation(
    rule: &MethodologyRule,
    question: &QuestionVersion,
    flow: Map<String, Value>,
    profile: Map<String, Value>,
) -> Result<RuleObservation, ResolveError> {
    let question = serde_json::to_value(question)?;
    let mut facts: Map<String, Value> = facts::FACTS
        .iter()
        .filter_map(|name| {
            Some((
                *name,
                question_fact(&question, name.strip_prefix("question.")?)?,
            ))
        })
        .map(|(name, fact)| (name.to_owned(), fact))
        .collect();
    facts.extend(flow);
    // A rule sees only the facts it declares it reads (ADR-0045).
    let reads = |name: &String| rule.reads.iter().any(|r| facts::covers(r.as_str(), name));
    facts.retain(|name, _| reads(name));
    let mut profile = profile;
    profile.retain(|name, _| reads(name));
    Ok(parse(
        &json!({
            "schema_version": "sprisk.rule_observation/v1",
            "rule": rule.id,
            "facts": facts,
            "profile": profile,
            "settings": rule.policy_thresholds,
        })
        .to_string(),
    )?)
}

/// The question's fact at `path`. A part of a structured fact, such as `costs.positive`, is
/// its own fact, as text, with the whole fact's origin.
fn question_fact(question: &Value, path: &str) -> Option<Value> {
    if path == "acceptance_criteria" {
        return criteria(question.get(path)?.as_array()?);
    }
    let Some((name, part)) = path.split_once('.') else {
        return question.get(path).cloned();
    };
    let fact = question.get(name)?;
    let value = fact.get("value")?.get(part)?;
    let text = value
        .as_str()
        .map_or_else(|| value.to_string(), str::to_owned);
    Some(json!({ "value": text, "origin": fact.get("origin")? }))
}

/// The acceptance criteria as one fact: their values joined by "; ", with the weakest origin
/// among them. None when there are none.
fn criteria(criteria: &[Value]) -> Option<Value> {
    const WEAKEST_FIRST: [&str; 4] = ["inferred", "measured", "explicit", "confirmed"];
    let texts: Vec<&str> = criteria
        .iter()
        .filter_map(|c| c["value"].as_str())
        .collect();
    let origin = WEAKEST_FIRST
        .iter()
        .find(|o| criteria.iter().any(|c| c["origin"] == **o))?;
    Some(json!({ "value": texts.join("; "), "origin": origin }))
}

/// What the flow says about the models downstream of `node_id`, read from their manifests
/// through `operator_of`. A model is hidden when it sits behind a step that does not `keep`
/// these facts, or behind another model: either may change the columns any way.
/// - `flow.model_families`: the families of the models it can see, sorted and joined by
///   `, `, or `featureless` when none of them declares one;
/// - `flow.models_hidden`: whether `all`, `some` or `none` of the models are hidden;
/// - `flow.other_readers`: the analysis or code steps downstream, which read the columns,
///   sorted and joined by `, `. Removing the step would change what they see;
/// - `step.<name>`: each text or list-of-text setting of the step itself, as set, so a rule knows what it
///   does now.
///
/// Read from the graph, so `measured`. Left out when no model is downstream, so a rule never
/// reads a stand-in value.
pub fn flow_facts<'a>(
    pipeline: &PipelineVersion,
    node_id: &str,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
    keeps: impl Fn(&Node) -> bool,
) -> Result<Map<String, Value>, ResolveError> {
    let is_model = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .and_then(|n| operator_of(n.operator.as_str()))
        .is_some_and(|o| o.model.is_some());
    let Downstream {
        seen,
        hidden,
        readers,
    } = downstream(pipeline, node_id, operator_of, keeps)?;
    let measured = |value: &str| json!({ "value": value, "origin": "measured" });
    let mut facts = Map::new();
    let step = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;
    for (name, value) in step.params.iter() {
        if let Some(text) = setting_text(value).filter(|t| !t.is_empty()) {
            facts.insert(
                format!("step.{name}"),
                json!({ "value": text, "origin": "explicit" }),
            );
        }
    }
    // A model step: which of its inputs Scale steps before it cover, for the rule that adds a
    // scale step for the others.
    if is_model {
        let upstream = crate::compare::upstream(pipeline, node_id);
        let scaled: BTreeSet<&str> = pipeline
            .nodes
            .iter()
            .filter(|n| n.id.as_str() != node_id && upstream.contains(n.id.as_str()))
            .filter(|n| n.operator.as_str().starts_with(SCALE))
            .filter_map(|n| n.params.get("columns")?.as_array())
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        let scaled = scaled.into_iter().collect::<Vec<_>>().join(", ");
        facts.insert(
            "flow.scaled_columns".into(),
            measured(if scaled.is_empty() { "none" } else { &scaled }),
        );
    }
    if !readers.is_empty() {
        let readers: Vec<String> = readers.into_iter().collect();
        facts.insert("flow.other_readers".into(), measured(&readers.join(", ")));
    }
    let total = seen.len() + hidden;
    if total == 0 {
        return Ok(facts);
    }
    let share = |doing: usize| match doing {
        0 => "none",
        n if n == total => "all",
        _ => "some",
    };
    if !seen.is_empty() {
        let families: BTreeSet<String> = seen
            .iter()
            .filter_map(|m| m.family)
            .map(|f| f.to_string())
            .collect();
        let families = if families.is_empty() {
            // Only models with no family, such as a dummy baseline, which ignores its features.
            "featureless".to_owned()
        } else {
            families.into_iter().collect::<Vec<_>>().join(", ")
        };
        facts.insert("flow.model_families".into(), measured(&families));
    }
    facts.insert("flow.models_hidden".into(), measured(share(hidden)));
    Ok(facts)
}

/// A setting as a fact's text: text as it is, a list of text sorted and joined by `, `, like
/// the flow's facts. None for anything else.
fn setting_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    let mut items: Vec<&str> = value
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    items.sort_unstable();
    Some(items.join(", "))
}

struct Downstream<'a> {
    /// Models reached only through steps that keep the facts.
    seen: Vec<&'a OperatorModel>,
    /// How many models are reached through a step that does not.
    hidden: usize,
    /// Analysis or code steps that read the columns. Removing the step would change what
    /// they see.
    readers: BTreeSet<String>,
}

/// The models downstream of `node_id`, not counting itself.
fn downstream<'a>(
    pipeline: &PipelineVersion,
    node_id: &str,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
    keeps: impl Fn(&Node) -> bool,
) -> Result<Downstream<'a>, ResolveError> {
    let mut graph = DiGraph::<&Node, ()>::new();
    let index: HashMap<&str, _> = pipeline
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), graph.add_node(n)))
        .collect();
    let step = |port: &PortRef| index.get(port.step_and_port().0).copied();
    for edge in &pipeline.edges {
        if let (Some(from), Some(to)) = (step(&edge.from), step(&edge.to)) {
            graph.add_edge(from, to, ());
        }
    }
    let start = *index
        .get(node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let mut seen = BTreeMap::new();
    let mut hidden = BTreeSet::new();
    let mut readers = BTreeSet::new();
    // Each step with whether the path to it passed a step that does not keep the facts.
    let mut stack = vec![(start, false)];
    let mut visited = HashSet::new();
    while let Some((at, behind)) = stack.pop() {
        for next in graph.neighbors(at) {
            if !visited.insert((next, behind)) {
                continue;
            }
            let node = graph[next];
            let operator = operator_of(node.operator.as_str())
                .ok_or_else(|| ResolveError::UnknownOperator(node.operator.as_str().to_owned()))?;
            if let Some(model) = &operator.model {
                if behind {
                    hidden.insert(next);
                } else {
                    seen.insert(next, model);
                }
            } else if operator.capability_class == CapabilityClass::Analyzer {
                // An analysis or code step reads the columns, even behind another step.
                readers.insert(node.id.as_str().to_owned());
            }
            // A model's output may carry the columns on (a clustering step adds a label to
            // its input table), changed by a fit, so what follows a model is behind it.
            let keeps_columns = operator.model.is_none() && keeps(node);
            stack.push((next, behind || !keeps_columns));
        }
    }
    // A model reached both ways may see changed columns, so it counts as hidden only.
    seen.retain(|step, _| !hidden.contains(step));
    Ok(Downstream {
        seen: seen.into_values().collect(),
        hidden: hidden.len(),
        readers,
    })
}

/// Measured values of `columns`, as `column.<name>.<measure>`, plus `rows`. Only the step's
/// columns: a rule decides about the step it serves. A measure the profile left out (no
/// variation, not numeric) stays out, so a rule never reads a stand-in value.
pub fn profile_facts(profile: &DatasetProfile, columns: &[String]) -> Map<String, Value> {
    let mut facts = Map::new();
    facts.insert("rows".into(), json!(profile.profiled_rows));
    for column in profile.columns.iter().filter(|c| columns.contains(&c.name)) {
        let key = |measure: &str| format!("column.{}.{measure}", column.name);
        let share = if profile.profiled_rows == 0 {
            0.0
        } else {
            column.missing as f64 / profile.profiled_rows as f64
        };
        facts.insert(key("missing_share"), json!(share));
        facts.insert(key("distinct"), json!(column.distinct));
        facts.insert(key("data_type"), json!(column.data_type));
        for (measure, value) in [
            ("skewness", column.skewness),
            ("kurtosis", column.kurtosis),
            ("outlier_share", column.outlier_share),
            ("iqr", column.iqr),
            ("word_share", column.word_share),
        ] {
            if let Some(value) = value {
                facts.insert(key(measure), json!(value));
            }
        }
    }
    facts
}

/// The structure of the rows a step reads, measured before the split (ADR-0059): row and
/// duplicate counts, and each column's type and the values that do not read as numbers. No
/// statistics: those come from train rows only.
pub fn input_facts(profile: &DatasetProfile) -> Map<String, Value> {
    let mut facts = Map::new();
    facts.insert("input.rows".into(), json!(profile.profiled_rows));
    if let Some(duplicates) = profile.duplicate_rows {
        facts.insert("input.duplicate_rows".into(), json!(duplicates));
    }
    for column in &profile.columns {
        let key = |measure: &str| format!("input.column.{}.{measure}", column.name);
        facts.insert(key("data_type"), json!(column.data_type));
        facts.insert(key("distinct"), json!(column.distinct));
        for (measure, share) in [
            ("numeric_share", column.numeric_share),
            ("word_share", column.word_share),
            ("html_share", column.html_share),
        ] {
            if let Some(share) = share {
                facts.insert(key(measure), json!(share));
            }
        }
        for (measure, value) in [
            ("case_variants", column.case_variants),
            ("accent_variants", column.accent_variants),
            ("leading_zero_values", column.leading_zero_values),
        ] {
            if let Some(value) = value {
                facts.insert(key(measure), json!(value));
            }
        }
        if !column.unconverted.is_empty() {
            facts.insert(key("unconverted"), json!(column.unconverted));
        }
    }
    facts
}

/// The target column of a step's train rows: its type, distinct values and, when it has few,
/// its rarest value's share. Empty when the rows have no such column.
pub fn target_facts(profile: &DatasetProfile, target: &str) -> Map<String, Value> {
    let mut facts = Map::new();
    let Some(column) = profile.columns.iter().find(|c| c.name == target) else {
        return facts;
    };
    facts.insert("target.data_type".into(), json!(column.data_type));
    facts.insert("target.distinct".into(), json!(column.distinct));
    if let Some(share) = column.rarest_share {
        facts.insert("target.rarest_share".into(), json!(share));
    }
    facts
}

/// The columns that identify rows, groups or time: the question's unit and time columns, and
/// every step's group and time column. They are never model inputs, even when a model step
/// leaves its features unset.
pub fn key_columns(question: &QuestionVersion, pipeline: &PipelineVersion) -> BTreeSet<String> {
    let asked = [&question.entity_column, &question.time_column]
        .into_iter()
        .flatten()
        .map(|fact| fact.value.to_string());
    let named = pipeline.nodes.iter().flat_map(|node| {
        ["group_column", "time_column"]
            .into_iter()
            .filter_map(|name| node.params.get(name)?.as_str().map(str::to_owned))
    });
    asked.chain(named).collect()
}

/// The steps and edges of `pipeline` without `node_id` (ADR-0043): each edge out of
/// `node_id.P` is fed from whatever fed `node_id.P`, and edges into it are dropped. Refused
/// when an output with consumers has no input of the same name to take its place.
pub fn without_node(
    pipeline: &PipelineVersion,
    node_id: &str,
) -> Result<(Vec<Node>, Vec<Edge>), ResolveError> {
    if !pipeline.nodes.iter().any(|n| n.id.as_str() == node_id) {
        return Err(ResolveError::UnknownNode(node_id.to_owned()));
    }
    let port_of = |port: &PortRef| {
        let (step, name) = port.step_and_port();
        (step == node_id).then(|| name.to_owned())
    };
    let feeds: HashMap<String, &PortRef> = pipeline
        .edges
        .iter()
        .filter_map(|e| Some((port_of(&e.to)?, &e.from)))
        .collect();
    let mut edges = Vec::new();
    for edge in &pipeline.edges {
        if port_of(&edge.to).is_some() {
            continue;
        }
        match port_of(&edge.from) {
            None => edges.push(edge.clone()),
            Some(port) => {
                let from = feeds
                    .get(&port)
                    .ok_or_else(|| ResolveError::Unremovable(edge.from.as_str().to_owned()))?;
                edges.push(Edge {
                    from: (*from).clone(),
                    to: edge.to.clone(),
                });
            }
        }
    }
    let nodes = pipeline
        .nodes
        .iter()
        .filter(|n| n.id.as_str() != node_id)
        .cloned()
        .collect();
    Ok((nodes, edges))
}

/// The steps and edges of `pipeline` with `step` added before `before` (ADR-0057), on the
/// rows `before` learns from. `step` reads the train and test rows of S, the step whose
/// `train` output feeds `before`'s `train`. `before` reads `step` in place of S, and so does
/// any step that reads an output of `before` and S's test rows, so a model's evaluation
/// scores rows prepared the same way. Every other reader of S keeps reading S.
///
/// A step that fits nothing and turns one table into one (marking placeholders, dropping
/// duplicates) is added instead on the one table `before` reads, such as the rows a split
/// takes (ADR-0059). Any other step is refused.
pub fn with_node_before<'a>(
    pipeline: &PipelineVersion,
    step: Node,
    before: &str,
    other: Option<&str>,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
) -> Result<(Vec<Node>, Vec<Edge>), ResolveError> {
    let refuse = |why: String| Err(ResolveError::NotInsertable(why));
    let id = step.id.as_str().to_owned();
    if pipeline.nodes.iter().any(|n| n.id.as_str() == id) {
        return refuse(format!("a step named {id} already exists"));
    }
    let at = pipeline
        .nodes
        .iter()
        .position(|n| n.id.as_str() == before)
        .ok_or_else(|| ResolveError::UnknownNode(before.to_owned()))?;
    let operator = step.operator.as_str();
    fn ports<'p>(
        names: impl IntoIterator<Item = &'p sprisk_contracts::PortName>,
    ) -> BTreeSet<String> {
        names.into_iter().map(|n| n.as_str().to_owned()).collect()
    }
    let train_test = BTreeSet::from(["test".to_owned(), "train".to_owned()]);
    // A step that also makes words (ADR-0058) feeds them to the step and its evaluations.
    let with_words =
        BTreeSet::from(["test", "test_words", "train", "train_words"].map(str::to_owned));
    let makes_words = operator_of(operator)
        .is_some_and(|o| ports(o.outputs.iter().map(|p| &p.name)) == with_words);
    let learns_from_train = operator_of(operator).is_some_and(|o| {
        o.fits_on_train == Some(true)
            && ports(o.inputs.iter().map(|p| &p.name)) == train_test
            && (makes_words || ports(o.outputs.iter().map(|p| &p.name)) == train_test)
    });
    let data = BTreeSet::from(["data".to_owned()]);
    let data_and_other = BTreeSet::from(["data".to_owned(), "other".to_owned()]);
    let fits_nothing_into_one = |inputs: &BTreeSet<String>| {
        operator_of(operator).is_some_and(|o| {
            o.fits_on_train != Some(true)
                && ports(o.inputs.iter().map(|p| &p.name)) == *inputs
                && ports(o.outputs.iter().map(|p| &p.name)) == data
        })
    };
    // A join reads a second table besides the one `before` reads (ADR-0059).
    if fits_nothing_into_one(&data_and_other) {
        let Some(other) = other else {
            return refuse(format!("{operator} joins, but no other table is named"));
        };
        let (nodes, mut edges) = on_the_one_table(pipeline, step, at, before)?;
        edges.push(edge(other, &format!("{id}.other"))?);
        return Ok((nodes, edges));
    }
    if other.is_some() {
        return refuse(format!(
            "{operator} does not join, so it takes no other table"
        ));
    }
    if fits_nothing_into_one(&data) {
        return on_the_one_table(pipeline, step, at, before);
    }
    if !learns_from_train {
        return refuse(format!(
            "{operator} does not learn from train rows and keep train and test apart"
        ));
    }
    let Some(source) = pipeline
        .edges
        .iter()
        .find(|e| e.to.step_and_port() == (before, "train"))
        .map(|e| e.from.step_and_port())
        .filter(|(_, port)| *port == "train")
        .map(|(source, _)| source)
    else {
        return refuse(format!(
            "step {before} takes no train output into its train input"
        ));
    };
    let readers: HashSet<&str> = pipeline
        .edges
        .iter()
        .filter(|e| e.from.step_and_port().0 == before)
        .map(|e| e.to.step_and_port().0)
        .collect();
    let mut edges = vec![
        edge(&format!("{source}.train"), &format!("{id}.train"))?,
        edge(&format!("{source}.test"), &format!("{id}.test"))?,
    ];
    if makes_words {
        edges.extend(words_edges(
            pipeline,
            &id,
            before,
            source,
            &readers,
            &operator_of,
        )?);
    }
    for e in &pipeline.edges {
        let (from, port) = e.from.step_and_port();
        let (to, input) = e.to.step_and_port();
        let moves = from == source
            && ((to == before && input == port) || (port == "test" && readers.contains(to)));
        if moves {
            edges.push(edge(&format!("{id}.{port}"), e.to.as_str())?);
        } else {
            edges.push(e.clone());
        }
    }
    let mut nodes = pipeline.nodes.clone();
    nodes.insert(at, step);
    Ok((nodes, edges))
}

/// The words step `id` makes, before `before` (ADR-0058): its train words to `before`, and
/// its test words to each reader of `before` that also reads `source`'s test rows and takes
/// words, so an evaluation scores the model with the words it was fit on. Refused when
/// `before` takes no words, or it or such a reader already reads some.
fn words_edges<'a>(
    pipeline: &PipelineVersion,
    id: &str,
    before: &str,
    source: &str,
    readers: &HashSet<&str>,
    operator_of: &impl Fn(&str) -> Option<&'a Operator>,
) -> Result<Vec<Edge>, ResolveError> {
    let refuse = |why: String| Err(ResolveError::NotInsertable(why));
    let takes_words = |step: &str| {
        pipeline
            .nodes
            .iter()
            .find(|n| n.id.as_str() == step)
            .and_then(|n| operator_of(n.operator.as_str()))
            .is_some_and(|o| o.inputs.iter().any(|p| p.name.as_str() == "words"))
    };
    let reads_words = |step: &str| {
        pipeline
            .edges
            .iter()
            .any(|e| e.to.step_and_port() == (step, "words"))
    };
    if !takes_words(before) {
        return refuse(format!("{before} takes no words"));
    }
    if reads_words(before) {
        return refuse(format!("{before} already reads words"));
    }
    let mut edges = vec![edge(
        &format!("{id}.train_words"),
        &format!("{before}.words"),
    )?];
    let scorers = pipeline.edges.iter().filter_map(|e| {
        let (to, input) = e.to.step_and_port();
        let scores = e.from.step_and_port() == (source, "test") && input == "test";
        (scores && readers.contains(to) && takes_words(to)).then_some(to)
    });
    for to in scorers {
        // Its words would come from another step's vocabulary than the model's.
        if reads_words(to) {
            return refuse(format!("{to} already reads words"));
        }
        edges.push(edge(&format!("{id}.test_words"), &format!("{to}.words"))?);
    }
    Ok(edges)
}

/// The one edge into `step`'s `data` input, when that is all `step` reads: the table a
/// structure rule measures and a one-table step goes in front of (ADR-0059). Otherwise why not.
pub fn one_table_into<'a>(pipeline: &'a PipelineVersion, step: &str) -> Result<&'a Edge, String> {
    let mut feeding = pipeline
        .edges
        .iter()
        .filter(|e| e.to.step_and_port().0 == step);
    let (Some(fed), None) = (feeding.next(), feeding.next()) else {
        return Err(format!("step {step} does not read exactly one table"));
    };
    let port = fed.to.step_and_port().1;
    if port != "data" {
        return Err(format!(
            "step {step} reads {port} rows, so test rows would skip it"
        ));
    }
    Ok(fed)
}

/// `pipeline` with the one-table `step` placed on the one edge into `before`'s `data` input,
/// at `at` in step order. Other readers of that edge's source keep reading it.
fn on_the_one_table(
    pipeline: &PipelineVersion,
    step: Node,
    at: usize,
    before: &str,
) -> Result<(Vec<Node>, Vec<Edge>), ResolveError> {
    let id = step.id.as_str().to_owned();
    let fed = one_table_into(pipeline, before).map_err(|why| {
        ResolveError::NotInsertable(format!(
            "{} turns one table into one, but {why}",
            step.operator.as_str()
        ))
    })?;
    let mut edges = Vec::with_capacity(pipeline.edges.len() + 1);
    for e in &pipeline.edges {
        if std::ptr::eq(e, fed) {
            edges.push(edge(fed.from.as_str(), &format!("{id}.data"))?);
            edges.push(edge(&format!("{id}.data"), fed.to.as_str())?);
        } else {
            edges.push(e.clone());
        }
    }
    let mut nodes = pipeline.nodes.clone();
    nodes.insert(at, step);
    Ok((nodes, edges))
}

/// The step whose `train` output feeds `node_id`'s `train` input, walked back to a split's
/// train output through steps that `keep_train` (ADR-0044, rule 8). Every hop is a train port
/// through a step that writes train rows from train rows only, so the table holds no test row.
pub fn train_rows_source<'p>(
    pipeline: &'p PipelineVersion,
    node_id: &str,
    is_split: impl Fn(&Node) -> bool,
    keeps_train: impl Fn(&Node) -> bool,
) -> Result<&'p str, ResolveError> {
    let chain = train_rows_chain(pipeline, node_id, is_split, keeps_train)?;
    Ok(chain[0])
}

/// The steps from the one feeding `node_id`'s `train` input back to the split, in that
/// order, as `train_rows_source` walks them. Never empty: the split is last.
pub(crate) fn train_rows_chain<'p>(
    pipeline: &'p PipelineVersion,
    node_id: &str,
    is_split: impl Fn(&Node) -> bool,
    keeps_train: impl Fn(&Node) -> bool,
) -> Result<Vec<&'p str>, ResolveError> {
    let node = |id: &str| pipeline.nodes.iter().find(|n| n.id.as_str() == id);
    let feeding = |id: &str| {
        pipeline
            .edges
            .iter()
            .find(|e| e.to.as_str() == format!("{id}.train"))
            .map(|e| e.from.step_and_port())
            .filter(|(_, port)| *port == "train")
            .map(|(step, _)| step)
    };
    let refuse = |why: String| Err(ResolveError::NotTrainRows(why));
    let Some(source) = feeding(node_id) else {
        return refuse(format!(
            "step {node_id} takes no train output into its train input"
        ));
    };
    let mut chain = vec![source];
    loop {
        let at = chain[chain.len() - 1];
        let Some(step) = node(at) else {
            return Err(ResolveError::UnknownNode(at.to_owned()));
        };
        if is_split(step) {
            return Ok(chain);
        }
        if !keeps_train(step) {
            return refuse(format!(
                "step {at} ({}) may mix rows between its inputs, so its train output may hold test rows",
                step.operator.as_str()
            ));
        }
        let Some(next) = feeding(at) else {
            return refuse(format!(
                "step {at} takes no train output into its train input"
            ));
        };
        chain.push(next);
    }
}

/// A new proposal's id and when it was made.
pub struct Stamp<'a> {
    pub id: &'a str,
    pub created_at: &'a str,
}

/// The proposal for `node_id`: each decided alternative with the manifest's label and
/// description, and, where applicable, its effect: `replace_node` with the manifest's
/// operator, or `remove_node` when the manifest's action says so (ADR-0043).
pub fn proposal(
    rule: &MethodologyRule,
    decision: &RuleDecision,
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    operators: &[&Operator],
    stamp: Stamp,
) -> Result<DecisionProposal, ResolveError> {
    let node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;
    let shortlist = rule.selection == Some(MethodologyRuleSelection::Shortlist);
    check_selection(decision, shortlist)?;
    let candidates = if shortlist {
        candidates(question.task.value, operators.iter().copied())?
    } else {
        BTreeMap::new()
    };
    // The baseline is the floor a comparison measures against (ADR-0044).
    let baseline = |id: &str| {
        candidates
            .get(id)
            .is_some_and(|o| o.model.as_ref().is_some_and(|m| m.family.is_none()))
    };
    if shortlist && !decision.shortlist.iter().any(|id| baseline(id.as_str())) {
        return Err(ResolveError::Selection(
            "a shortlist needs the baseline, a model with no family, to compare against".into(),
        ));
    }
    let mut alternatives = Vec::new();
    for decided in &decision.alternatives {
        let id = decided.id.as_str();
        let mut built = json!({
            "id": id,
            "applicability": decided.applicability,
            "reason": decided.reason,
        });
        let applicable = matches!(
            decided.applicability,
            RuleDecisionAlternativesItemApplicability::Applicable
        );
        if shortlist {
            let operator = candidates
                .get(id)
                .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
            built["label"] = json!(operator.id);
            built["description"] = json!(operator.description);
            if applicable {
                built["effect"] = json!({ "kind": "replace_node", "node_id": node_id, "operator": operator.id, "params": params_for(operator, node) });
            }
        } else {
            let declared = rule
                .alternatives
                .iter()
                .find(|m| m.id.as_str() == id)
                .ok_or_else(|| ResolveError::UndeclaredAlternative(id.to_owned()))?;
            built["label"] = json!(declared.label);
            built["description"] = json!(declared.description);
            if declared.action.type_ == RuleActionType::RemoveNode {
                if applicable {
                    built["effect"] = json!({ "kind": "remove_node", "node_id": node_id });
                }
            } else if declared.action.type_ == RuleActionType::UpdateEstimatorParams {
                if applicable {
                    let params =
                        updated_params(id, node, &declared.action.params, &decided.params)?;
                    built["effect"] = json!({ "kind": "replace_node", "node_id": node_id, "operator": node.operator, "params": params });
                }
            } else if declared.action.type_ == RuleActionType::InsertStep {
                if applicable {
                    // Only an insert before the rule's step is wired (ADR-0057).
                    let before = declared
                        .action
                        .placement
                        .as_ref()
                        .is_some_and(|p| p.as_str() == "before");
                    let (true, Some(params), Some(operator), Some(wanted)) = (
                        before,
                        &decided.params,
                        &declared.action.operator,
                        &declared.action.node_id,
                    ) else {
                        return Err(ResolveError::NotInsertable(format!(
                            "{id} needs placement before, an operator, a node_id and params"
                        )));
                    };
                    let step = free_id(&pipeline.nodes, wanted.as_str());
                    built["effect"] = json!({ "kind": "insert_node", "node_id": step, "operator": operator,
                                              "params": params, "before": node_id });
                    if let Some(other) = other_table(pipeline, operator.as_str(), operators)? {
                        built["effect"]["other"] = json!(other);
                    }
                }
            } else if let (Some(params), Some(operator)) =
                (&decided.params, &declared.action.operator)
            {
                let mut kept = model_settings(operators, node, operator.as_str())?;
                kept.extend(params.0.clone());
                built["effect"] = json!({ "kind": "replace_node", "node_id": node_id, "operator": operator, "params": kept });
            }
        }
        alternatives.push(built);
    }
    let fingerprint_input =
        json!({ "rule": rule.id, "question": question, "pipeline": pipeline, "node_id": node_id });
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let mut built = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": stamp.id,
        "rule": rule.id,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": decision.evidence,
        "alternatives": alternatives,
        "fingerprint": fingerprint,
        "created_at": stamp.created_at,
    });
    if let Some(recommended) = &decision.recommended_alternative_id {
        built["recommended_alternative_id"] = json!(recommended);
    }
    if shortlist {
        built["shortlist"] = json!(decision.shortlist);
    }
    Ok(parse(&built.to_string())?)
}

/// The step's params with each one the action names (ADR-0053) set from the decision, or
/// dropped when the decision leaves it out. The model stays; only its settings change.
fn updated_params(
    id: &str,
    node: &Node,
    named: &Map<String, Value>,
    decided: &Option<sprisk_contracts::Params>,
) -> Result<Map<String, Value>, ResolveError> {
    let named: Vec<&String> = named.keys().collect();
    let decided: Map<String, Value> = decided.as_ref().map(|p| p.0.clone()).unwrap_or_default();
    if let Some(other) = decided.keys().find(|k| !named.contains(k)) {
        return Err(ResolveError::Selection(format!(
            "{id} sets {other}, which its action does not name"
        )));
    }
    let mut params: Map<String, Value> = node
        .params
        .iter()
        .filter(|(name, _)| !named.contains(name))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    params.extend(decided);
    Ok(params)
}

/// A recommend rule picks one alternative it offers; a shortlist rule puts forward some it
/// offers and picks none (ADR-0044).
fn check_selection(decision: &RuleDecision, shortlist: bool) -> Result<(), ResolveError> {
    let offered = |id: &str| decision.alternatives.iter().any(|a| a.id.as_str() == id);
    let recommended = decision.recommended_alternative_id.as_ref();
    let problem = match (shortlist, recommended) {
        (false, None) => Some("a recommend rule must pick an alternative".to_owned()),
        (false, Some(_)) if !decision.shortlist.is_empty() => {
            Some("a recommend rule gives no shortlist".to_owned())
        }
        (false, Some(r)) if !offered(r.as_str()) => Some(format!(
            "it recommends {}, which it does not offer",
            r.as_str()
        )),
        (true, Some(_)) => Some("a shortlist rule recommends no single alternative".to_owned()),
        (true, None) if decision.shortlist.is_empty() => {
            Some("a shortlist rule must put forward at least one alternative".to_owned())
        }
        (true, None) => decision
            .shortlist
            .iter()
            .find(|id| !offered(id.as_str()))
            .map(|id| format!("it shortlists {}, which it does not offer", id.as_str())),
        _ => None,
    };
    problem.map_or(Ok(()), |p| Err(ResolveError::Selection(p)))
}

/// The step's params that `operator` accepts, so a candidate keeps the step's target,
/// features and task.
fn params_for(operator: &Operator, node: &Node) -> Map<String, Value> {
    let accepted = operator
        .params_schema
        .get("properties")
        .and_then(Value::as_object);
    node.params
        .iter()
        .filter(|(name, _)| accepted.is_some_and(|a| a.contains_key(*name)))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect()
}

/// The settings a model step keeps when a rule replaces it by another model: its target,
/// task, features and costs, whatever the new model accepts. Any other step keeps nothing, so
/// it takes only the settings the rule decided: an old split's stratify or group column must
/// not come back.
fn model_settings(
    operators: &[&Operator],
    node: &Node,
    replacement: &str,
) -> Result<Map<String, Value>, ResolveError> {
    let find = |id: &str| operators.iter().find(|o| o.id.to_string() == id);
    if find(node.operator.as_str()).is_none_or(|o| o.model.is_none()) {
        return Ok(Map::new());
    }
    let new = find(replacement).ok_or_else(|| ResolveError::UnknownOperator(replacement.into()))?;
    Ok(if new.model.is_some() {
        params_for(new, node)
    } else {
        Map::new()
    })
}

/// `wanted`, or `wanted` with the first suffix `_2`, `_3`, … that no step in `nodes` has.
pub(crate) fn free_id(nodes: &[Node], wanted: &str) -> String {
    let taken = |id: &str| nodes.iter().any(|n| n.id.as_str() == id);
    let mut id = wanted.to_owned();
    let mut n = 1;
    while taken(&id) {
        n += 1;
        id = format!("{wanted}_{n}");
    }
    id
}

/// The id a candidate model goes by: its operator name without `sprisk.`, with dots as
/// underscores, e.g. `ml_random_forest`.
fn candidate_id(operator: &str) -> String {
    let name = operator.split('@').next().unwrap_or_default();
    name.strip_prefix("sprisk.")
        .unwrap_or(name)
        .replace('.', "_")
}

/// The registered models that fit `task`, by candidate id (ADR-0044). Two models with one
/// id, such as two versions of one model, are refused: one would silently hide the other.
pub fn candidates<'a>(
    task: TaskType,
    operators: impl Iterator<Item = &'a Operator>,
) -> Result<BTreeMap<String, &'a Operator>, ResolveError> {
    let mut found = BTreeMap::new();
    let fits = |o: &Operator| o.model.as_ref().is_some_and(|m| m.tasks.contains(&task));
    for operator in operators.filter(|o| fits(o)) {
        let id = candidate_id(operator.id.as_str());
        if let Some(first) = found.insert(id.clone(), operator) {
            return Err(ResolveError::SharedCandidateId {
                id,
                first: first.id.to_string(),
                second: operator.id.to_string(),
            });
        }
    }
    Ok(found)
}

/// The `cv.*` facts of the model a step runs (`operator`), read from its model selection
/// (ADR-0059): the metric, its mean fold score, the baseline's, whether it beats the baseline
/// by the selection's test (absent for the baseline itself), whether the selection chose it,
/// and how many decided looks the flow's family of versions has taken. Only a comparison of
/// models against a floor baseline has them: a reference baseline compares preparation.
pub fn result_facts(
    selection: &SelectionDecision,
    operator: &str,
    looks: i64,
) -> Result<Map<String, Value>, ResolveError> {
    if selection.baseline_role == Some(BaselineRole::Reference) {
        return Err(ResolveError::Selection(
            "it compares ways of preparing the data, not models against a floor".into(),
        ));
    }
    let id = candidate_id(operator);
    let scored = |id: &str| selection.candidates.iter().find(|c| c.id.as_str() == id);
    let model = scored(&id).ok_or_else(|| ResolveError::NotCompared(id.clone()))?;
    let baseline = scored(selection.baseline.as_str())
        .ok_or_else(|| ResolveError::NotCompared(selection.baseline.to_string()))?;
    let mut facts = Map::new();
    facts.insert("cv.metric".into(), json!(selection.metric));
    facts.insert("cv.score".into(), json!(model.mean));
    facts.insert("cv.baseline_score".into(), json!(baseline.mean));
    if let Some(versus) = &model.versus_baseline {
        let verdict = if versus.beats_baseline { "yes" } else { "no" };
        facts.insert("cv.beats_baseline".into(), json!(verdict));
    }
    let chosen = selection.winner.as_ref().is_some_and(|w| w.as_str() == id);
    facts.insert(
        "cv.selected".into(),
        json!(if chosen { "yes" } else { "no" }),
    );
    facts.insert("cv.looks".into(), json!(looks));
    Ok(facts)
}

/// The table a joining `operator` (one with an `other` input) reads besides the step's own:
/// the one loaded table no step reads. None for an operator that does not join.
fn other_table(
    pipeline: &PipelineVersion,
    operator: &str,
    operators: &[&Operator],
) -> Result<Option<PortRef>, ResolveError> {
    let find = |id: &str| operators.iter().copied().find(|o| o.id.as_str() == id);
    let joins = find(operator).is_some_and(|o| o.inputs.iter().any(|p| p.name.as_str() == "other"));
    if !joins {
        return Ok(None);
    }
    match unread_sources(pipeline, find)?.as_slice() {
        [one] => Ok(Some(one.clone())),
        many => Err(ResolveError::NotInsertable(format!(
            "{operator} joins one other table, but {} loaded tables are read by no step",
            many.len()
        ))),
    }
}

/// The tables loaded by a source step that no step reads, as `<step>.<port>`: what a join may
/// add to the rows a flow predicts on (ADR-0059).
pub fn unread_sources<'a>(
    pipeline: &PipelineVersion,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
) -> Result<Vec<PortRef>, ResolveError> {
    let read: HashSet<&str> = pipeline.edges.iter().map(|e| e.from.as_str()).collect();
    pipeline
        .nodes
        .iter()
        .filter_map(|n| Some((n, operator_of(n.operator.as_str())?)))
        .filter(|(_, o)| o.capability_class == CapabilityClass::Source)
        .flat_map(|(n, o)| {
            o.outputs
                .iter()
                .filter(|p| p.kind == sprisk_contracts::PortKind::Table)
                .map(move |p| format!("{}.{}", n.id.as_str(), p.name.as_str()))
        })
        .filter(|output| !read.contains(output.as_str()))
        .map(|output| Ok(parse(&json!(output).to_string())?))
        .collect()
}

/// The `join.*` facts (ADR-0059): how many loaded tables no step reads, and, given how the
/// step's rows match the one such table, its row count and each shared column's matches.
pub fn join_facts(unread: usize, matches: Option<&KeyMatches>) -> Map<String, Value> {
    let mut facts = Map::new();
    facts.insert("join.unread_tables".into(), json!(unread));
    if let Some(matches) = matches {
        facts.insert("join.rows".into(), json!(matches.rows));
        for key in &matches.keys {
            let name = |part: &str| format!("join.key.{}.{part}", key.column.as_str());
            facts.insert(name("matched_rows"), json!(key.matched_rows));
            facts.insert(name("most_rows_per_key"), json!(key.most_rows_per_key));
        }
    }
    facts
}

/// `candidate.<id>.family` for each candidate, `featureless` for one with no family.
pub fn candidate_facts(candidates: &BTreeMap<String, &Operator>) -> Map<String, Value> {
    candidates
        .iter()
        .map(|(id, operator)| {
            let family = operator
                .model
                .as_ref()
                .and_then(|m| m.family)
                .map_or_else(|| "featureless".to_owned(), |f| f.to_string());
            (
                format!("candidate.{id}.family"),
                json!({ "value": family, "origin": "measured" }),
            )
        })
        .collect()
}
