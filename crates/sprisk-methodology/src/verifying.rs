//! What the walk checks after a run (ADR-0063 slice 5): each promise its decisions made, on
//! the evidence the run measured, and whether the test rows may be scored. Pure: the API runs
//! verify_<name>() in Python.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use sprisk_contracts::{
    Method, MethodVerified, PipelineVersion, PromiseCheck, PromiseResult, VerificationOutcome,
    VerificationRequest, parse,
};

use crate::compare::upstream;
use crate::deciding::Made;
use crate::{ResolveError, RuleCatalog};

/// One promise an option the walk took makes.
#[derive(Debug)]
pub struct Promise<'c> {
    pub method: &'c Method,
    pub name: String,
    /// The evidence kind it needs.
    pub needs: String,
    /// What holds when it passes, for people.
    pub promise: String,
    settings: Value,
}

/// Every promise the options in `made` make, in decision order.
pub fn promises<'c>(
    catalog: &'c RuleCatalog,
    made: &[Made],
) -> Result<Vec<Promise<'c>>, ResolveError> {
    let mut found = Vec::new();
    for decided in made {
        let method = catalog
            .methods()
            .find(|m| m.decides.as_str() == decided.decides)
            .ok_or_else(|| {
                ResolveError::NotInsertable(format!("no method decides {}", decided.decides))
            })?;
        let option = method
            .options
            .iter()
            .find(|o| o.id.as_str() == decided.option)
            .ok_or_else(|| ResolveError::UndeclaredOption {
                method: method.id.to_string(),
                option: decided.option.clone(),
            })?;
        for name in &option.verify {
            // Refused when packs load too; a promise skipped here would unseal the test rows.
            let verification = method
                .verifications
                .iter()
                .find_map(|(k, v)| (k.as_str() == name.as_str()).then_some(v))
                .ok_or_else(|| {
                    ResolveError::NotInsertable(format!(
                        "{} promises {}, which it does not declare",
                        method.id.as_str(),
                        name.as_str()
                    ))
                })?;
            found.push(Promise {
                method,
                name: name.as_str().to_owned(),
                needs: verification.needs.as_str().to_owned(),
                promise: verification.promise.to_string(),
                settings: serde_json::to_value(&verification.settings)?,
            });
        }
    }
    Ok(found)
}

/// What a run's producers measured, by evidence kind: the step that measured it, and its fields.
pub type Measured = BTreeMap<String, (String, Value)>;

/// A promise, and the request that checks it with the step whose evidence it reads; None
/// when nothing measured its evidence.
#[derive(Debug)]
pub struct Checking<'c> {
    pub promise: Promise<'c>,
    pub request: Option<(String, VerificationRequest)>,
}

/// What to check for each promise the options in `made` make, on the evidence in `measured`.
pub fn checking<'c>(
    catalog: &'c RuleCatalog,
    made: &[Made],
    measured: &Measured,
) -> Result<Vec<Checking<'c>>, ResolveError> {
    promises(catalog, made)?
        .into_iter()
        .map(|promise| {
            let Some((step, evidence)) = measured.get(&promise.needs) else {
                return Ok(Checking {
                    promise,
                    request: None,
                });
            };
            let module = catalog.method_module(promise.method.id.as_str())?;
            let settings = match &promise.settings {
                Value::Null => json!({}),
                set => set.clone(),
            };
            let request = parse(
                &json!({
                    "schema_version": "sprisk.verification_request/v1",
                    "module": module.display().to_string(), "method": promise.method.id,
                    "verification": promise.name, "evidence": evidence, "settings": settings,
                })
                .to_string(),
            )?;
            Ok(Checking {
                promise,
                request: Some((step.clone(), request)),
            })
        })
        .collect()
}

impl Checking<'_> {
    /// The record of a promise nothing measured.
    pub fn not_evaluated(&self) -> Result<PromiseCheck, ResolveError> {
        let detail = format!(
            "No step measured {}, so the promise was not checked.",
            self.promise.needs
        );
        self.record(None, PromiseResult::NotEvaluated, &detail)
    }

    fn record(
        &self,
        step: Option<&str>,
        result: PromiseResult,
        detail: &str,
    ) -> Result<PromiseCheck, ResolveError> {
        let mut check = json!({
            "decides": self.promise.method.decides, "method": self.promise.method.id,
            "verification": self.promise.name, "promise": self.promise.promise,
            "result": result, "detail": detail,
        });
        if let Some(step) = step {
            check["step"] = json!(step);
        }
        Ok(parse(&check.to_string())?)
    }
}

/// The record of what verify_<name>() found on the evidence its step measured.
pub fn checked(
    checking: &Checking<'_>,
    verified: &MethodVerified,
) -> Result<PromiseCheck, ResolveError> {
    let result = match verified.result {
        VerificationOutcome::Pass => PromiseResult::Pass,
        VerificationOutcome::Fail => PromiseResult::Fail,
        VerificationOutcome::Inconclusive => PromiseResult::Inconclusive,
    };
    let step = checking.request.as_ref().map(|(step, _)| step.as_str());
    checking.record(step, result, verified.detail.as_str())
}

/// Why the test rows stay sealed: each promise in `checks` that did not pass, or that the
/// promises were not checked on the flow (None). None when all passed.
pub fn sealed_by(checks: Option<&[PromiseCheck]>) -> Option<String> {
    let Some(checks) = checks else {
        return Some(
            "The test rows stay sealed: the promises were not checked on this flow.".to_owned(),
        );
    };
    let open: Vec<String> = checks
        .iter()
        .filter(|c| c.result != PromiseResult::Pass)
        .map(|c| {
            format!(
                "{} promised {} ({}), and it is {}: {}",
                c.decides.as_str(),
                c.verification.as_str(),
                c.promise.as_str(),
                c.result,
                c.detail.as_str()
            )
        })
        .collect();
    if open.is_empty() {
        return None;
    }
    Some(format!(
        "The test rows stay sealed until every promise passes. {}",
        open.join(" ")
    ))
}

/// Whether `check`, made on `verified`, still holds for `later`: the step that measured its
/// evidence, and every step before it, are the same in both, with the same settings, code
/// and inputs. A promise nothing measured holds only for the version it was checked on.
pub fn fresh(verified: &PipelineVersion, later: &PipelineVersion, check: &PromiseCheck) -> bool {
    let Some(step) = &check.step else {
        return verified.id == later.id;
    };
    let before = what_fed(verified, step.as_str());
    !before.is_empty() && before == what_fed(later, step.as_str())
}

/// The step `step` and every step before it, each with the edges into it, as canonical JSON.
/// Empty when the flow has no such step.
fn what_fed(pipeline: &PipelineVersion, step: &str) -> BTreeSet<String> {
    let steps = upstream(pipeline, step);
    let nodes = pipeline
        .nodes
        .iter()
        .filter(|n| steps.contains(n.id.as_str()))
        .map(|n| json!(n).to_string());
    let edges = pipeline
        .edges
        .iter()
        .filter(|e| steps.contains(e.to.step_and_port().0))
        .map(|e| json!(e).to_string());
    nodes.chain(edges).collect()
}
