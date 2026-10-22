"""Whether cross-validation results send the flow back, or on to the test rows (ADR-0059).

A model with no lift over the baseline, by the model selection's own test, stops: changing the
features until a test passes would fish for one. A model the selection did not choose (it lost,
or failed a guardrail) reopens the model choice. A chosen model below the success bar a person
stated reopens the features. Either reopen stops once the flow's family of versions has looked
at the folds `max_looks` times, since more looks would fit the folds (Cawley & Talbot 2010).
Test rows are never read.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.errors import RuleError
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    needs_fact,
    not_applicable,
    profile_evidence,
    question_evidence,
    required_number,
)

LABEL = {
    "balanced_accuracy": "balanced accuracy",
    "expected_cost": "expected cost",
    "rmse": "RMSE",
    "weighted_f1": "weighted F1",
}
LOWER_IS_BETTER = {"expected_cost", "rmse"}
ALTERNATIVES = ("proceed", "reopen", "reopen_models", "stop")
LABELS = {
    "question.success_bar.metric": "Success bar metric",
    "question.success_bar.score": "Success bar",
}


def decide(observation: RuleObservation) -> RuleDecision:
    metric = _text(observation, "cv.metric", tuple(LABEL))
    score = required_number(observation, "cv.score")
    baseline = required_number(observation, "cv.baseline_score")
    looks = int(required_number(observation, "cv.looks"))
    beats = _text(observation, "cv.beats_baseline", ("yes", "no"))
    selected = _text(observation, "cv.selected", ("yes", "no"))
    max_looks = int(observation.settings["max_looks"])
    name = LABEL[metric]
    evidence = question_evidence(observation, LABELS) + [
        profile_evidence(f"Cross-validated {name}", f"{score:.3g}"),
        profile_evidence(f"Baseline {name}", f"{baseline:.3g}"),
        profile_evidence("Looks at these folds", str(looks)),
    ]
    if beats == "no":
        why = (
            f"The model's {name} of {score:.3g} does not beat the baseline's {baseline:.3g}: "
            "stop and report no lift for these models and features."
        )
        return _pick(observation, "stop", why, evidence)
    if selected == "no":
        why = "The model selection did not choose this model: it lost, or failed a guardrail"
        return _back(observation, "reopen_models", why, looks, max_looks, evidence)

    bar_metric = authoritative(observation.facts.get("question.success_bar.metric"))
    bar_text = authoritative(observation.facts.get("question.success_bar.score"))
    if bar_metric != metric or bar_text is None:
        stated = "" if bar_metric is None else f" It is stated in {LABEL[bar_metric]}."
        ask = f"State the success bar as a {name} score: the models were compared by it.{stated}"
        waiting = "Needs the success bar first."
        alternatives = [needs_fact("proceed", ask)]
        alternatives += [not_applicable(id, waiting) for id in ALTERNATIVES[1:]]
        return decision(observation, "proceed", alternatives, evidence)

    bar = float(bar_text)
    meets = score <= bar if metric in LOWER_IS_BETTER else score >= bar
    if meets:
        why = (
            f"The model's {name} of {score:.3g} meets the bar of {bar:g}. It was chosen on these "
            "folds, so this score is optimistic: score the test rows once for the honest number."
        )
        return _pick(observation, "proceed", why, evidence)
    why = f"The model's {name} of {score:.3g} misses the bar of {bar:g}"
    return _back(observation, "reopen", why, looks, max_looks, evidence)


def _back(
    observation: RuleObservation,
    reopen: str,
    why: str,
    looks: int,
    max_looks: int,
    evidence: list[dict[str, Any]],
) -> RuleDecision:
    if looks >= max_looks:
        stopped = f"{why}, after {looks} looks at the same folds: stop and report it as it stands."
        return _pick(observation, "stop", stopped, evidence)
    again = f"{why}: reopen it, then compare the models again ({looks} of {max_looks} looks taken)."
    return _pick(observation, reopen, again, evidence)


def _pick(
    observation: RuleObservation, chosen: str, why: str, evidence: list[dict[str, Any]]
) -> RuleDecision:
    alternatives = [
        applicable(id, why, {}) if id == chosen else not_applicable(id, why) for id in ALTERNATIVES
    ]
    return decision(observation, chosen, alternatives, evidence)


def _text(observation: RuleObservation, name: str, allowed: tuple[str, ...]) -> str:
    value = observation.profile.get(name)
    if not isinstance(value, str) or value not in allowed:
        raise RuleError(f"the cross-validation results give {value!r} for {name}")
    return value
