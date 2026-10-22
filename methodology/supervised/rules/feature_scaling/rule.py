"""Which scaling a step uses, from the models downstream and the train rows' tails (ADR-0042).

A model fits only the model (ADR-0056), so it takes its inputs as they are. Scaling has no
effect when only trees, models that ignore their features, or plain least-squares regressions
are downstream. Otherwise heavy tails or outliers distort the mean and SD, so they get median
and IQR scaling.

On a linear model step (ADR-0057): logistic regression is penalised, and the penalty depends
on the scale of its inputs, so the inputs no Scale step before it covers get one.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    ask_readers,
    decision,
    flow_evidence,
    flow_fact,
    is_numeric,
    measured,
    model_families,
    not_applicable,
    profile_evidence,
    step_columns,
)

FAMILIES = "flow.model_families"
HIDDEN = "flow.models_hidden"
READERS = "flow.other_readers"
SCALED = "flow.scaled_columns"
SCALE_STEP = ("no_scaling", "robust_scaling", "standard_scaling", "maxabs_scaling_sparse")
MODEL_STEP = ("leave_inputs", "insert_robust_scaling", "insert_standard_scaling")


def decide(observation: RuleObservation) -> RuleDecision:
    # Only a model step is sent whether a Scale step comes before it.
    if flow_fact(observation, SCALED) is not None:
        return _model_step(observation)
    return _scale_step(observation)


def _model_step(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    task = flow_fact(observation, "step.task")
    covered = flow_fact(observation, SCALED)
    scaled = [] if covered in (None, "none") else covered.split(", ")
    columns = [c for c in step_columns(observation) if is_numeric(observation, c)]
    spread = [
        c
        for c in columns
        if c not in scaled
        and measured(observation, c, "kurtosis") is not None
        and measured(observation, c, "iqr") != 0
    ]
    heavy = [
        c
        for c in spread
        if (measured(observation, c, "kurtosis") or 0.0) > s["outlier_kurtosis_threshold"]
        or (measured(observation, c, "outlier_share") or 0.0) >= s["outlier_share_threshold"]
    ]
    evidence = flow_evidence(observation, ["step.task", SCALED])
    off = [not_applicable(i, "This is a model step, not a Scale step.") for i in SCALE_STEP]
    if task != "classification" or not spread:
        why = (
            "Plain least-squares regression predicts the same whatever the scale."
            if task != "classification"
            else "Scale steps before it already cover every input that varies."
            if scaled
            else "No numeric input varies on the train rows, so there is nothing to scale."
        )
        leave = applicable("leave_inputs", why, {})
        add = [not_applicable(i, why) for i in MODEL_STEP[1:]]
        return decision(observation, "leave_inputs", [leave, *add, *off], evidence)
    penalty = (
        "Logistic regression's L2 penalty treats every coefficient alike, so unscaled inputs "
        "are penalised unevenly."
    )
    leave = not_applicable("leave_inputs", penalty)
    robust = applicable(
        "insert_robust_scaling",
        f"{penalty} {', '.join(heavy)} has heavy tails or outliers; median and IQR resist them."
        if heavy
        else f"{penalty} Available; tails are light.",
        {"columns": spread, "method": "robust"},
    )
    standard = applicable(
        "insert_standard_scaling",
        f"{penalty} Light tails: mean and SD describe the spread."
        if not heavy
        else f"{penalty} Available, but outliers inflate the SD.",
        {"columns": spread, "method": "z_score"},
    )
    pick = "insert_robust_scaling" if heavy else "insert_standard_scaling"
    return decision(observation, pick, [leave, robust, standard, *off], evidence)


def _scale_step(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    families = model_families(observation)
    hidden = flow_fact(observation, HIDDEN)
    columns = step_columns(observation)
    kurtosis = {c: v for c in columns if (v := measured(observation, c, "kurtosis")) is not None}
    outliers = {
        c: v for c in columns if (v := measured(observation, c, "outlier_share")) is not None
    }
    text = [c for c in columns if not is_numeric(observation, c)]
    # The profile gives no shape to a column without variation; the scale step refuses those.
    flat = [c for c in columns if c not in text and c not in kurtosis]
    # With Q1 = Q3 robust scaling divides by zero, and the IQR fences that measure outliers
    # meet, so such a column says nothing about tails: it is left out of both.
    flat_iqr = [c for c in columns if measured(observation, c, "iqr") == 0]
    spread = [c for c in columns if c not in flat_iqr]
    heavy = [
        c
        for c in spread
        if kurtosis.get(c, 0.0) > s["outlier_kurtosis_threshold"]
        or outliers.get(c, 0.0) >= s["outlier_share_threshold"]
    ]
    task = observation.facts.get("question.task")
    no_effect = _no_effect(families, hidden, task.value if task is not None else None)

    if text or flat:
        why = (
            f"The scale step needs numbers; {', '.join(text)} is text."
            if text
            else f"{', '.join(flat)} has no spread in the train rows, so it cannot be scaled."
        )
        robust = not_applicable("robust_scaling", why)
        standard = not_applicable("standard_scaling", why)
    elif no_effect:
        unused = "Available, but it has no effect on the models downstream."
        robust = _robust(spread, flat_iqr, unused)
        standard = applicable("standard_scaling", unused, {"columns": columns, "method": "z_score"})
    else:
        robust = _robust(
            spread,
            flat_iqr,
            f"{', '.join(heavy)} has heavy tails or outliers; median and IQR resist them."
            if heavy
            else "Available; tails are light, so it differs little from standard scaling.",
        )
        standard = applicable(
            "standard_scaling",
            "Light tails and no outliers: mean and SD describe the spread well."
            if not heavy
            else "Available, but outliers inflate the SD and squash the other values.",
            {"columns": columns, "method": "z_score"},
        )
    none = ask_readers(observation, _no_scaling(families, hidden, no_effect))
    maxabs = not_applicable("maxabs_scaling_sparse", "The scale step has no max-abs method.")

    evidence = flow_evidence(observation, [FAMILIES, HIDDEN, READERS])
    evidence += [profile_evidence(f"{c} excess kurtosis", f"{v:.2f}") for c, v in kurtosis.items()]
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in outliers.items()]
    evidence += [profile_evidence(f"{c} IQR", "0") for c in flat_iqr]
    if no_effect:
        recommended = "no_scaling"
    elif heavy:
        recommended = "robust_scaling"
    else:
        recommended = "standard_scaling"
    off = [not_applicable(i, "This is a Scale step, not a model step.") for i in MODEL_STEP]
    return decision(observation, recommended, [none, robust, standard, maxabs, *off], evidence)


def _robust(spread: list[str], flat_iqr: list[str], reason: str) -> dict[str, Any]:
    no_iqr = (
        f"{', '.join(flat_iqr)} has no IQR spread in train, so robust scaling cannot divide by it."
    )
    if not spread:
        return not_applicable("robust_scaling", no_iqr)
    if flat_iqr:
        reason += f" Left out: {no_iqr}"
    return applicable("robust_scaling", reason, {"columns": spread, "method": "robust"})


def _no_effect(families: set[str], hidden: str | None, task: str | None) -> str | None:
    """Why scaling here cannot change the models downstream, or None when it can."""
    if hidden != "none":
        return None
    if families == {"tree_ensemble"}:
        return "Only tree models are downstream. They split on rank order, which scaling keeps."
    if families == {"featureless"}:
        return "The only models downstream ignore their features, such as a dummy baseline."
    if task == "regression" and families <= {"linear", "tree_ensemble", "featureless"}:
        return (
            "The models downstream are plain least-squares regressions, trees or a baseline; "
            "none of them predicts differently on scaled inputs."
        )
    return None


def _no_scaling(families: set[str], hidden: str | None, no_effect: str | None) -> dict[str, Any]:
    if no_effect:
        # Removing the step needs no params (ADR-0043).
        return {"id": "no_scaling", "applicability": "applicable", "reason": no_effect}
    if hidden is None:
        why = "Scaling may matter: no model is downstream of this step yet."
    elif hidden != "none":
        why = "A model downstream sits behind a step the rules cannot see, so scaling may matter."
    else:
        scaled = sorted(families - {"tree_ensemble", "featureless"})
        one = len(scaled) == 1
        why = (
            f"The {' and '.join(scaled)} {'model' if one else 'models'} downstream "
            f"{'takes its' if one else 'take their'} inputs as they are, so scaling matters."
        )
    return not_applicable("no_scaling", why)
