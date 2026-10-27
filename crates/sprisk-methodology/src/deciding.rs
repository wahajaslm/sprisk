//! What methods decide in a walk (ADR-0063 slice 4 and its amendment). Pure: which methods
//! are ready, what each may read, and the bindings and patch its option makes. The API runs
//! decide() in Python and applies the patch.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};
use sprisk_contracts::{
    Binding, GraphEffect, Method, MethodAssurance, MethodRequest, Operator, OperatorAttachSide,
    OperatorRole, PipelineVersion, PromiseResult, QuestionStatement, QuestionVersion,
    RuledOutOption, WalkAction, WalkAsk, WalkStep, parse,
};

use crate::compare::upstream;
use crate::decision::{free_id, other_table};
use crate::measure::{fitting, measurable};
use crate::{ResolveError, RuleCatalog, methods};

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
    /// The round of the decide step that made it.
    pub round: u64,
    /// Options of this decision a failed promise ruled out. When `option` is one, the
    /// decision is made again from the options left.
    pub ruled_out: Vec<RuledOutOption>,
}

/// The decisions in force after the walk's `steps`, in the order they were made. A decision
/// made again takes the place of the earlier one, and every decision that read it is dropped,
/// to be made again too: what it read changed, so it starts with no option ruled out. A promise that failed rules out the option in force when it was
/// checked, for the rest of the walk (ADR-0063 amendment).
pub fn made_by(catalog: &RuleCatalog, steps: &[WalkStep]) -> Result<Vec<Made>, ResolveError> {
    let mut made: Vec<Made> = Vec::new();
    for step in steps {
        match step.action {
            WalkAction::Decide => {
                let (Some(decides), Some(option)) = (&step.decides, &step.option) else {
                    return Err(ResolveError::BrokenDecideStep {
                        walk: step.walk_id.to_string(),
                        round: step.round,
                    });
                };
                let decides = decides.to_string();
                let ruled_out = match made.iter().position(|m| m.decides == decides) {
                    Some(at) => {
                        let earlier = made.remove(at);
                        drop_readers(catalog, &mut made, &decides)?;
                        earlier.ruled_out
                    }
                    None => Vec::new(),
                };
                made.push(Made {
                    decides,
                    option: option.to_string(),
                    bindings: step.bindings.clone(),
                    round: step.round,
                    ruled_out,
                });
            }
            WalkAction::Verify => {
                for check in step
                    .verifications
                    .iter()
                    .filter(|c| c.result == PromiseResult::Fail)
                {
                    let Some(decided) = made
                        .iter_mut()
                        .find(|m| m.decides == check.decides.as_str())
                    else {
                        continue;
                    };
                    if decided.reopened() {
                        continue;
                    }
                    let method = catalog
                        .methods()
                        .find(|m| m.decides.as_str() == decided.decides)
                        .ok_or_else(|| ResolveError::UnknownMethod(decided.decides.clone()))?;
                    // Every option making the same promise would break it on these rows too:
                    // another random draw that passes by chance is not a fair split.
                    let same_promise = method.options.iter().filter(|o| {
                        o.id.as_str() == decided.option || o.verify.contains(&check.verification)
                    });
                    for option in same_promise {
                        if decided.ruled_out.iter().any(|r| r.option == option.id) {
                            continue;
                        }
                        decided.ruled_out.push(parse(
                            &json!({ "option": option.id, "verification": check.verification,
                                     "detail": check.detail })
                            .to_string(),
                        )?);
                    }
                }
            }
            _ => {}
        }
    }
    Ok(made)
}

/// Why the walk cannot reopen a decision a failed promise ruled out: a comparison, a rule's
/// change or the score came after it, and they were chosen on the rows it made. Reopening
/// then would move rows that informed selection into the test rows.
pub fn reopened_too_late(made: &[Made], steps: &[WalkStep]) -> Option<String> {
    let late = |m: &Made| {
        steps.iter().any(|s| {
            s.round > m.round
                && matches!(
                    s.action,
                    WalkAction::Apply | WalkAction::Compare | WalkAction::Score
                )
        })
    };
    let found: Vec<String> = made
        .iter()
        .filter(|m| m.reopened() && late(m))
        .map(|m| {
            let broken: Vec<&str> = m.ruled_out.iter().map(|r| r.detail.as_str()).collect();
            format!(
                "{} broke its promise after the flow was chosen on its rows: {} Walk again \
                 so it is decided before anything is compared.",
                m.decides,
                broken.join(" ")
            )
        })
        .collect();
    (!found.is_empty()).then(|| found.join(" "))
}

/// Drops from `made` every decision whose method reads `changed`, and those that read them.
fn drop_readers(
    catalog: &RuleCatalog,
    made: &mut Vec<Made>,
    changed: &str,
) -> Result<(), ResolveError> {
    let mut changed = vec![changed.to_owned()];
    while let Some(key) = changed.pop() {
        let mut kept = Vec::with_capacity(made.len());
        for decided in made.drain(..) {
            let method = catalog
                .methods()
                .find(|m| m.decides.as_str() == decided.decides)
                .ok_or_else(|| ResolveError::UnknownMethod(decided.decides.clone()))?;
            if method.needs.decisions.iter().any(|d| d.as_str() == key) {
                changed.push(decided.decides);
            } else {
                kept.push(decided);
            }
        }
        *made = kept;
    }
    Ok(())
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
    /// Decisions to make again whose every option a failed promise ruled out.
    pub exhausted: Vec<Exhausted>,
}

/// A decision no option is left for: each one broke a promise on these rows.
#[derive(Debug)]
pub struct Exhausted {
    pub decides: String,
    pub ruled_out: Vec<RuledOutOption>,
}

impl Exhausted {
    /// Each option and what its failed check found, for the walk's stop.
    pub fn detail(&self) -> String {
        let broken: Vec<String> = self
            .ruled_out
            .iter()
            .map(|r| {
                format!(
                    "{} ({}: {})",
                    r.option.as_str(),
                    r.verification.as_str(),
                    r.detail.as_str()
                )
            })
            .collect();
        format!(
            "{}: every option broke its promise: {}",
            self.decides,
            broken.join("; ")
        )
    }
}

impl Made {
    /// Whether a failed promise ruled out the option in force, so it is decided again.
    fn reopened(&self) -> bool {
        self.ruled_out
            .iter()
            .any(|r| r.option.as_str() == self.option)
    }
}

/// The methods fitting the question that are not decided yet and can decide: every decision
/// they read is made, no concept they read is only a guess, no undecided method may still
/// change the rows their evidence is measured on, and each evidence kind they need is in
/// `measured` or cannot be measured (see `measure::measurable`). One whose evidence can be
/// measured but is not yet waits for the walk to measure it.
pub fn ready<'c>(
    catalog: &'c RuleCatalog,
    question: &QuestionVersion,
    made: &[Made],
    effective: &Effective,
    measured: &BTreeMap<String, Value>,
    operators: &[Operator],
    pipeline: &PipelineVersion,
) -> Result<Readiness<'c>, ResolveError> {
    let by_id: BTreeMap<String, &Operator> =
        operators.iter().map(|o| (o.id.to_string(), o)).collect();
    let decided: BTreeMap<&str, &Made> = made.iter().map(|m| (m.decides.as_str(), m)).collect();
    let bound: BTreeSet<&str> = effective
        .bindings
        .iter()
        .map(|b| b.concept.as_str())
        .collect();
    let mut found = Readiness {
        ready: Vec::new(),
        asks: Vec::new(),
        exhausted: Vec::new(),
    };
    // The undecided methods and the steps their options may change: a method measuring rows
    // after one of those steps waits, so it decides on the rows the model will see.
    let mut open: Vec<Open> = Vec::new();
    for (order, m) in fitting(catalog, question).enumerate() {
        if decided.get(m.decides.as_str()).is_none_or(|d| d.reopened()) {
            open.push(Open {
                order,
                changes: changed_steps(m, pipeline, &by_id),
                writes_measured: measured_at(m, pipeline, &by_id)?
                    .into_iter()
                    .filter(|(_, side)| *side == OperatorAttachSide::Output)
                    .map(|(step, _)| step)
                    .collect(),
            });
        }
    }
    'methods: for (order, method) in fitting(catalog, question).enumerate() {
        let ruled_out: &[RuledOutOption] = match decided.get(method.decides.as_str()) {
            Some(made) if made.reopened() => &made.ruled_out,
            Some(_) => continue,
            None => &[],
        };
        let options: Vec<&str> = method
            .options
            .iter()
            .map(|o| o.id.as_str())
            .filter(|o| !ruled_out.iter().any(|r| r.option.as_str() == *o))
            .collect();
        if options.is_empty() {
            found.exhausted.push(Exhausted {
                decides: method.decides.to_string(),
                ruled_out: ruled_out.to_vec(),
            });
            continue;
        }
        let mut decisions = Map::new();
        for key in &method.needs.decisions {
            // A decision made again may change: what reads it waits.
            let Some(made) = decided.get(key.as_str()).filter(|m| !m.reopened()) else {
                continue 'methods;
            };
            decisions.insert(key.to_string(), json!(made.option));
        }
        let guessed: Vec<&String> = method
            .needs
            .concepts
            .iter()
            .filter_map(|c| effective.guesses.get(c.as_str()))
            .collect();
        if !guessed.is_empty() {
            for fact in guessed {
                // Two methods reading one guess ask it once.
                let ask = guess_ask(method, fact)?;
                if !found.asks.iter().any(|a| a.decides == ask.decides) {
                    found.asks.push(ask);
                }
            }
            continue;
        }
        for (at, side) in measured_at(method, pipeline, &by_id)? {
            if open
                .iter()
                .any(|other| other.changes_before(order, at, side, pipeline))
            {
                continue 'methods;
            }
        }
        let mut evidence = Map::new();
        for kind in &method.needs.evidence {
            if let Some(fields) = measured.get(kind.as_str()) {
                evidence.insert(kind.to_string(), fields.clone());
                continue;
            }
            let producer = methods::producer_of(kind.as_str(), &by_id)?;
            let operator_of = |id: &str| by_id.get(id).copied();
            if measurable(producer, |c| bound.contains(c), pipeline, operator_of)? {
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
        let mut request = json!({
            "schema_version": "sprisk.method_request/v1",
            "module": module.display().to_string(), "method": method.id,
            "needs": method.needs, "options": options, "task": question.task.value,
            "evidence": evidence, "decisions": decisions, "bound": needed_bound,
        });
        if !ruled_out.is_empty() {
            request["ruled_out"] = json!(ruled_out);
        }
        if !method.needs.statements.is_empty() {
            request["statements"] = Value::Object(statements(question, &method.needs.statements)?);
        }
        let request = parse(&request.to_string())?;
        found.ready.push(Ready { method, request });
    }
    Ok(found)
}

/// The value of each `needed` statement the question makes, by its name. A statement is
/// never guessed, so there is nothing to confirm.
fn statements(
    question: &QuestionVersion,
    needed: &[QuestionStatement],
) -> Result<Map<String, Value>, ResolveError> {
    let mut found = Map::new();
    for statement in needed {
        let value = match statement {
            QuestionStatement::Costs => question.costs.as_ref().map(|f| json!(f.value)),
            QuestionStatement::Interpretability => {
                question.interpretability.as_ref().map(|f| json!(f.value))
            }
            QuestionStatement::SuccessBar => question.success_bar.as_ref().map(|f| json!(f.value)),
        };
        if let Some(value) = value {
            found.insert(statement.to_string(), value);
        }
    }
    Ok(found)
}

/// An undecided method: its place in decision order, the steps its options change, and the
/// steps whose output its evidence is measured on.
struct Open<'p> {
    order: usize,
    changes: Vec<Changed<'p>>,
    writes_measured: Vec<&'p str>,
}

impl Open<'_> {
    /// Whether this method may still change the rows a method at `order` measures on `at`.
    /// A step upstream may change. So may `at` itself: replacing it changes what it writes,
    /// not what it reads; a step inserted in front of it changes both. Two methods that would
    /// wait on each other go in decision order.
    fn changes_before(
        &self,
        order: usize,
        at: &str,
        side: OperatorAttachSide,
        pipeline: &PipelineVersion,
    ) -> bool {
        if self.order == order {
            return false;
        }
        let before = upstream(pipeline, at);
        let earlier = self.order < order;
        let writes = side == OperatorAttachSide::Output;
        self.changes.iter().any(|c| match c {
            Changed::Replaced(s) if *s == at => writes,
            Changed::InsertedBefore(s) if *s == at => {
                earlier || (writes && !self.writes_measured.contains(&at))
            }
            Changed::Replaced(s) | Changed::InsertedBefore(s) => before.contains(s),
        })
    }
}

/// A step a method's option changes: one it inserts a step before, or one it replaces.
enum Changed<'p> {
    InsertedBefore(&'p str),
    Replaced(&'p str),
}

/// The steps `method`'s options insert before or replace, found by role.
fn changed_steps<'p>(
    method: &Method,
    pipeline: &'p PipelineVersion,
    by_id: &BTreeMap<String, &Operator>,
) -> Vec<Changed<'p>> {
    let actions: Vec<_> = method
        .options
        .iter()
        .filter_map(|o| o.action.as_ref())
        .collect();
    let inserted: BTreeSet<OperatorRole> = actions
        .iter()
        .filter_map(|a| a.insert.as_ref().map(|i| i.before))
        .collect();
    let replaced: BTreeSet<OperatorRole> = actions
        .iter()
        .filter_map(|a| a.replace.as_ref().map(|r| r.role))
        .collect();
    let mut changed: Vec<Changed<'p>> = steps_with(pipeline, by_id, |r| inserted.contains(&r))
        .into_iter()
        .map(Changed::InsertedBefore)
        .collect();
    changed.extend(
        steps_with(pipeline, by_id, |r| replaced.contains(&r))
            .into_iter()
            .map(Changed::Replaced),
    );
    changed
}

/// The steps where `method`'s evidence is measured, those its producers attach to, and on
/// which side.
fn measured_at<'p>(
    method: &Method,
    pipeline: &'p PipelineVersion,
    by_id: &BTreeMap<String, &Operator>,
) -> Result<Vec<(&'p str, OperatorAttachSide)>, ResolveError> {
    let mut at = Vec::new();
    for kind in &method.needs.evidence {
        if let Some(attach) = &methods::producer_of(kind.as_str(), by_id)?.attach {
            for step in steps_with(pipeline, by_id, |role| role == attach.role) {
                if !at.contains(&(step, attach.side)) {
                    at.push((step, attach.side));
                }
            }
        }
    }
    Ok(at)
}

fn steps_with<'p>(
    pipeline: &'p PipelineVersion,
    by_id: &BTreeMap<String, &Operator>,
    role: impl Fn(OperatorRole) -> bool,
) -> Vec<&'p str> {
    pipeline
        .nodes
        .iter()
        .filter(|n| {
            by_id
                .get(n.operator.as_str())
                .and_then(|o| o.role)
                .is_some_and(&role)
        })
        .map(|n| n.id.as_str())
        .collect()
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

/// What an option is applied on: the bindings in force, the flow, the registered operators,
/// what was measured and the question.
pub struct Basis<'a> {
    pub bindings: &'a [Binding],
    pub pipeline: &'a PipelineVersion,
    pub operators: &'a [Operator],
    pub measured: &'a BTreeMap<String, Value>,
    pub question: &'a QuestionVersion,
}

/// The bindings and patch of `option` on the basis's flow. A param a concept fills reads its
/// binding's column; a column a step adds makes the replaced step read that step's output
/// of the same name; a param read from evidence takes the field's value in `measured`; a
/// setting read from a statement takes what the question states. The caller applies the
/// patch with `patch::apply`, which checks it.
pub fn apply_option(
    method: &Method,
    option: &str,
    assurance: MethodAssurance,
    basis: &Basis,
) -> Result<Applied, ResolveError> {
    let Basis {
        bindings: effective,
        pipeline,
        operators,
        measured,
        question,
    } = *basis;
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
        let producer = methods::producer_of(bind.evidence.as_str(), &by_id)?;
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
        // A model swapped for another keeps its target, task, features and costs, as a rule's
        // swap does; the option's own settings come on top.
        let replaced = pipeline
            .nodes
            .iter()
            .find(|n| n.id.as_str() == step)
            .ok_or_else(|| ResolveError::UnknownNode(step.clone()))?;
        let all: Vec<&Operator> = operators.iter().collect();
        let mut params = crate::decision::model_settings(&all, replaced, operator.id.as_str())?;
        params.extend(
            replace
                .settings
                .iter()
                .flat_map(|s| s.iter())
                .map(|(k, v)| (k.clone(), v.clone())),
        );
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
                    // The adder moves onto the rows the step read until now, so steps placed
                    // between the load and the step still run before it.
                    let fed = |to: &str| {
                        pipeline
                            .edges
                            .iter()
                            .find(|e| e.to.as_str() == to)
                            .map(|e| e.from.to_string())
                    };
                    let read = fed(&format!("{step}.{port}"));
                    let adder_reads = fed(&format!("{adds}.{port}"));
                    if let Some(read) = read.filter(|r| Some(r) != adder_reads.as_ref()) {
                        applied.effects.push(parse(
                            &json!({ "kind": "set_input", "node_id": adds, "port": port,
                                     "from": read })
                            .to_string(),
                        )?);
                    }
                    applied.effects.push(parse(
                        &json!({ "kind": "set_input", "node_id": step, "port": port,
                                 "from": format!("{adds}.{port}") })
                        .to_string(),
                    )?);
                }
            }
        }
    }
    if let Some(insert) = &action.insert {
        let operator = by_id
            .get(insert.operator.as_str())
            .ok_or_else(|| ResolveError::UnknownOperator(insert.operator.to_string()))?;
        let role = insert.before;
        let before = one_step(
            pipeline,
            |n| {
                by_id
                    .get(n.operator.as_str())
                    .is_some_and(|o| o.role == Some(role))
            },
            &format!("the role {role}"),
        )?;
        let mut params: Map<String, Value> = insert
            .settings
            .iter()
            .flat_map(|s| s.iter())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (param, path) in &insert.from_evidence {
            let path = path.as_str();
            // `<area>.<evidence>.<field>`, checked when the packs load.
            let (kind, field) = path.rsplit_once('.').unwrap_or((path, ""));
            let value = measured
                .get(kind)
                .and_then(|fields| fields.get(field))
                .ok_or_else(|| {
                    ResolveError::NotInsertable(format!(
                        "{} reads {path}, which was not measured",
                        method.id.as_str()
                    ))
                })?;
            params.insert(param.to_string(), value.clone());
        }
        for (param, concept) in &insert.concepts {
            // An unbound concept leaves its param out; compiling refuses a required one.
            let Some(binding) = effective
                .iter()
                .chain(&applied.bindings)
                .find(|b| b.concept.as_str() == concept.as_str())
            else {
                continue;
            };
            let column = json!(binding.source.column);
            let listed = operator
                .params_schema
                .get("properties")
                .and_then(|p| p.get(param.as_str()))
                .is_some_and(|schema| schema["type"] == "array");
            params.insert(
                param.to_string(),
                if listed { json!([column]) } else { column },
            );
        }
        params.extend(crate::asset_params(operator, question));
        let mut inserted = json!({ "kind": "insert_node",
            "node_id": free_id(&pipeline.nodes, insert.node_id.as_str()),
            "operator": operator.id, "params": params, "before": before });
        let all: Vec<&Operator> = operators.iter().collect();
        if let Some(other) = other_table(pipeline, operator.id.as_str(), &all)? {
            inserted["other"] = json!(other);
        }
        applied.effects.push(parse(&inserted.to_string())?);
    }
    if let Some(set) = &action.set {
        let role = set.role;
        let step = one_step(
            pipeline,
            |n| {
                by_id
                    .get(n.operator.as_str())
                    .is_some_and(|o| o.role == Some(role))
            },
            &format!("the role {role}"),
        )?;
        let node = pipeline
            .nodes
            .iter()
            .find(|n| n.id.as_str() == step)
            .ok_or_else(|| ResolveError::UnknownNode(step.clone()))?;
        let mut params: Map<String, Value> = node
            .params
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        params.extend(
            set.settings
                .iter()
                .flat_map(|s| s.iter())
                .map(|(k, v)| (k.clone(), v.clone())),
        );
        let needed: Vec<QuestionStatement> = set.from_statements.values().cloned().collect();
        let stated = statements(question, &needed)?;
        for (param, statement) in &set.from_statements {
            // A person's answer is taken as given: one that would set nothing is refused.
            let value = stated.get(&statement.to_string()).ok_or_else(|| {
                ResolveError::NotInsertable(format!(
                    "{} sets {} from {statement}, which the question does not state",
                    method.id.as_str(),
                    param.as_str()
                ))
            })?;
            params.insert(param.to_string(), value.clone());
        }
        applied.effects.push(parse(
            &json!({ "kind": "replace_node", "node_id": step, "operator": node.operator,
                     "params": params })
            .to_string(),
        )?);
    }
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
