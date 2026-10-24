//! The report a completed walk ends in (ADR-0064): the question, the answer and a claim per
//! decision and per promise, each resting on records by id. Built from the trail, never
//! written by a model.

use serde_json::{Value, json};

use sprisk_contracts::{
    PipelineVersionId, QuestionVersion, Report, RunId, WalkAction, WalkId, WalkStep, parse,
};

/// What every walk's answer leaves open, whatever it found.
const LIMITATIONS: [&str; 2] = [
    "A predictive score, not a causal effect: it says how well the model predicts on these \
     rows, not why.",
    "The test rows come from the same files as the training rows; rows from another time or \
     source may score lower.",
];

/// The records a scored walk ends on: its trail, the score run and the flow it scored.
pub struct Scored<'a> {
    pub walk: &'a WalkId,
    pub question: &'a QuestionVersion,
    pub steps: &'a [WalkStep],
    pub answer: &'a str,
    pub run: &'a RunId,
    pub flow: &'a PipelineVersionId,
    /// What the score's class shares step measured; None for a regression.
    pub shares: Option<&'a Value>,
}

/// The report of `scored`, as `id` at `at`. A claim with no record under it is a broken
/// trail, never left in.
pub fn build(scored: &Scored<'_>, id: &str, at: &str) -> Result<Report, String> {
    let mut claims = Vec::new();
    for step in scored.steps {
        if let Some(claim) = decision_claim(step)? {
            claims.push(claim);
        }
    }
    if let Some(verified) = scored
        .steps
        .iter()
        .rev()
        .find(|s| s.action == WalkAction::Verify)
    {
        claims.extend(promise_claims(verified));
    }
    let mut limitations: Vec<String> = LIMITATIONS.iter().map(|l| (*l).to_owned()).collect();
    if let Some(shares) = scored.shares {
        let (claim, drift) = shares_claim(shares, scored.run)?;
        claims.push(claim);
        limitations.extend(drift);
    }
    let answer = json!({
        "statement": scored.answer,
        "evidence": [{ "run": scored.run }, { "pipeline_version": scored.flow }],
    });
    let report = json!({
        "schema_version": "sprisk.report/v1", "id": id, "walk_id": scored.walk,
        "question_version_id": scored.question.id,
        "question": scored.question.objective.value, "answer": answer, "claims": claims,
        "limitations": limitations, "created_at": at,
    });
    parse(&report.to_string()).map_err(|e| e.to_string())
}

/// How far a class's share moved between the train and test rows, read with the score, and
/// a limitation when the measure found it drifted.
fn shares_claim(shares: &Value, run: &RunId) -> Result<(Value, Option<String>), String> {
    let field = |name: &str| {
        shares
            .get(name)
            .ok_or_else(|| format!("the class shares have no {name}"))
    };
    let gap = field("largest_gap")?
        .as_f64()
        .ok_or("largest_gap is not a number")?;
    let class = field("class")?.as_str().ok_or("class is not text")?;
    let drifted = field("drifted")?
        .as_bool()
        .ok_or("drifted is not true or false")?;
    let statement = format!(
        "Class shares, train against test: the largest difference is {:.1}% (class {class}), \
         on {} train and {} labelled test rows.",
        gap * 100.0,
        field("train_rows")?,
        field("labelled_test_rows")?
    );
    let drift = drifted.then(|| {
        format!(
            "The test rows' class shares differ from the train rows' by {:.1}% for class \
             {class}, so the score weighs the classes differently than training did.",
            gap * 100.0
        )
    });
    let claim = json!({ "statement": statement, "evidence": [{ "run": run }] });
    Ok((claim, drift))
}

/// What a decide or apply step chose and why, on its decision and its step.
fn decision_claim(step: &WalkStep) -> Result<Option<Value>, String> {
    let chose = match step.action {
        WalkAction::Decide => step.option.as_ref().map(|o| o.to_string()),
        WalkAction::Apply => step.alternative_id.as_ref().map(|a| a.to_string()),
        _ => return Ok(None),
    };
    let (Some(decides), Some(chose), Some(decision)) =
        (&step.decides, chose, &step.methodology_decision_id)
    else {
        return Err(format!(
            "step {} decides without naming what, which option or its decision",
            step.round
        ));
    };
    Ok(Some(json!({
        "statement": format!("{}: {chose}. {}", decides.as_str(), step.reason.as_str()),
        "evidence": [{ "decision": decision }, { "walk_step": at_step(step) }],
    })))
}

/// What each promise check of the last verify step found, on that step and the run it read.
fn promise_claims(verified: &WalkStep) -> Vec<Value> {
    verified
        .verifications
        .iter()
        .map(|check| {
            let mut evidence = vec![json!({ "walk_step": at_step(verified) })];
            if let Some(run) = &verified.run_id {
                evidence.push(json!({ "run": run }));
            }
            json!({
                "statement": format!(
                    "{} ({}): {}. {}",
                    check.promise.as_str(),
                    check.decides.as_str(),
                    check.result,
                    check.detail.as_str()
                ),
                "evidence": evidence,
            })
        })
        .collect()
}

fn at_step(step: &WalkStep) -> Value {
    json!({ "walk_id": step.walk_id, "round": step.round })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn fixture<T: serde::de::DeserializeOwned>(entity: &str, name: &str) -> T {
        let path = format!(
            "{}/../../tests/contract/{entity}/valid/{name}",
            env!("CARGO_MANIFEST_DIR")
        );
        parse(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn report_of(steps: &[WalkStep]) -> Result<Report, String> {
        report_with(steps, None)
    }

    fn report_with(steps: &[WalkStep], shares: Option<&Value>) -> Result<Report, String> {
        let question: QuestionVersion =
            fixture("question_version", "classification-all-fields.json");
        let walk = steps[0].walk_id.clone();
        let run: RunId = parse("\"run_01JABCDEFGHJKMNPQRSTVWXYZ0\"").unwrap();
        let flow: PipelineVersionId = parse("\"plv_01JABCDEFGHJKMNPQRSTVWXYZ1\"").unwrap();
        let scored = Scored {
            walk: &walk,
            question: &question,
            steps,
            answer: "Test rows, scored once.",
            run: &run,
            flow: &flow,
            shares,
        };
        build(
            &scored,
            "rpt_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "2026-10-24T19:00:00Z",
        )
    }

    #[test]
    fn each_decision_and_each_promise_of_the_last_check_is_a_claim_on_its_records() {
        let mut decided: WalkStep = fixture("walk_step", "decide.json");
        decided.methodology_decision_id =
            Some(parse("\"mdc_01JABCDEFGHJKMNPQRSTVWXYZ1\"").unwrap());
        let applied: WalkStep = fixture("walk_step", "apply.json");
        let verified: WalkStep = fixture("walk_step", "verify.json");

        let report = report_of(&[decided, applied, verified]).unwrap();

        let claims = serde_json::to_value(&report.claims).unwrap();
        assert_eq!(claims.as_array().unwrap().len(), 4, "{claims}");
        assert_eq!(
            claims[0]["evidence"][0]["decision"],
            "mdc_01JABCDEFGHJKMNPQRSTVWXYZ1"
        );
        assert!(
            claims[0]["statement"]
                .as_str()
                .unwrap()
                .starts_with("split.method: item_groups.")
        );
        assert_eq!(
            claims[2]["evidence"][1]["run"],
            "run_01JABCDEFGHJKMNPQRSTVWXYZ0"
        );
        assert!(
            claims
                .as_array()
                .unwrap()
                .iter()
                .all(|c| !c["evidence"].as_array().unwrap().is_empty())
        );
    }

    #[test]
    fn a_decision_step_that_names_no_decision_record_is_a_broken_trail() {
        let decided: WalkStep = fixture("walk_step", "decide.json");

        let err = report_of(&[decided]).unwrap_err();

        assert!(err.contains("step 4"), "{err}");
    }

    #[test]
    fn class_shares_that_drift_are_a_claim_and_a_limitation_of_the_score() {
        let applied: WalkStep = fixture("walk_step", "apply.json");
        let measured = |gap: f64, drifted: bool| {
            json!({ "largest_gap": gap, "class": "2583", "drifted": drifted, "train_rows": 800,
                    "labelled_test_rows": 200 })
        };
        let (drifted, kept) = (measured(0.12, true), measured(0.004, false));

        let report = report_with(std::slice::from_ref(&applied), Some(&drifted)).unwrap();
        let claims = serde_json::to_value(&report.claims).unwrap();
        let last = &claims[claims.as_array().unwrap().len() - 1];
        assert!(
            last["statement"]
                .as_str()
                .unwrap()
                .contains("12.0% (class 2583)"),
            "{last}"
        );
        assert_eq!(
            last["evidence"],
            json!([{ "run": "run_01JABCDEFGHJKMNPQRSTVWXYZ0" }])
        );
        assert!(
            report.limitations.iter().any(|l| l.contains("class 2583")),
            "{:?}",
            report.limitations
        );

        let report = report_with(&[applied], Some(&kept)).unwrap();
        assert!(!report.limitations.iter().any(|l| l.contains("class 2583")));
    }

    #[test]
    fn class_shares_missing_a_field_are_refused_and_named() {
        let applied: WalkStep = fixture("walk_step", "apply.json");

        let err = report_with(&[applied], Some(&json!({ "class": "a" }))).unwrap_err();

        assert!(err.contains("no largest_gap"), "{err}");
    }
}
