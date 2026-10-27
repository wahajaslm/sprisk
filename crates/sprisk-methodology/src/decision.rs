//! The flow's structure that decisions rest on: the columns that identify rows, where a step
//! is inserted or removed, and where a step's train rows and second table come from.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{Map, Value, json};
use sprisk_contracts::{
    CapabilityClass, Edge, Node, Operator, PipelineVersion, PortRef, QuestionVersion, parse,
};

use crate::ResolveError;
use crate::compare::edge;

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
pub(crate) fn model_settings(
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

/// The table a joining `operator` (one with an `other` input) reads besides the step's own:
/// the one loaded table no step reads. None for an operator that does not join.
pub(crate) fn other_table(
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
/// add to the rows a flow predicts on (ADR-0059). An evidence producer that writes only a
/// report only measures what it reads, so its reading does not count.
pub fn unread_sources<'a>(
    pipeline: &PipelineVersion,
    operator_of: impl Fn(&str) -> Option<&'a Operator>,
) -> Result<Vec<PortRef>, ResolveError> {
    let measures = |step: &str| {
        pipeline
            .nodes
            .iter()
            .find(|n| n.id.as_str() == step)
            .and_then(|n| operator_of(n.operator.as_str()))
            .is_some_and(|o| {
                !o.produces.is_empty()
                    && o.outputs
                        .iter()
                        .all(|p| p.kind == sprisk_contracts::PortKind::Report)
            })
    };
    let read: HashSet<&str> = pipeline
        .edges
        .iter()
        .filter(|e| !measures(e.to.step_and_port().0))
        .map(|e| e.from.as_str())
        .collect();
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
