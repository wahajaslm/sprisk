"""Which scaling a step uses, from the models downstream and the train rows' tails (ADR-0042).

Scaling here has no effect when every model downstream standardises its own inputs, or when
only trees are downstream. Otherwise heavy tails or outliers distort the mean and SD, so
they get median and IQR scaling.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    flow_evidence,
    flow_fact,
    is_numeric,
    measured,
    not_applicable,
    profile_evidence,
    step_columns,
)

FAMILY = "flow.model_family"
STANDARDIZE = "flow.models_standardize"


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    family = flow_fact(observation, FAMILY)
    standardize = flow_fact(observation, STANDARDIZE)
    columns = step_columns(observation)
    kurtosis = {c: v for c in columns if (v := measured(observation, c, "kurtosis")) is not None}
    outliers = {
        c: v for c in columns if (v := measured(observation, c, "outlier_share")) is not None
    }
    text = [c for c in columns if not is_numeric(observation, c)]
    # The profile gives no shape to a column without variation; the scale step refuses those.
    flat = [c for c in columns if c not in text and c not in kurtosis]
    heavy = [
        c
        for c in columns
        if kurtosis.get(c, 0.0) > s["outlier_kurtosis_threshold"]
        or outliers.get(c, 0.0) >= s["outlier_share_threshold"]
    ]
    no_effect = _no_effect(family, standardize)

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
        robust = applicable("robust_scaling", unused, {"columns": columns, "method": "robust"})
        standard = applicable("standard_scaling", unused, {"columns": columns, "method": "z_score"})
    else:
        robust = applicable(
            "robust_scaling",
            f"{', '.join(heavy)} has heavy tails or outliers; median and IQR resist them."
            if heavy
            else "Available; tails are light, so it differs little from standard scaling.",
            {"columns": columns, "method": "robust"},
        )
        standard = applicable(
            "standard_scaling",
            "Light tails and no outliers: mean and SD describe the spread well."
            if not heavy
            else "Available, but outliers inflate the SD and squash the other values.",
            {"columns": columns, "method": "z_score"},
        )
    none = _no_scaling(family, standardize, no_effect)
    maxabs = not_applicable("maxabs_scaling_sparse", "The scale step has no max-abs method.")

    evidence = flow_evidence(observation, [FAMILY, STANDARDIZE])
    evidence += [profile_evidence(f"{c} excess kurtosis", f"{v:.2f}") for c, v in kurtosis.items()]
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in outliers.items()]
    if no_effect:
        recommended = "none_tree_models"
    elif heavy:
        recommended = "robust_scaling"
    else:
        recommended = "standard_scaling"
    return decision(observation, recommended, [none, robust, standard, maxabs], evidence)


def _no_effect(family: str | None, standardize: str | None) -> str | None:
    """Why scaling here cannot change the models downstream, or None when it can."""
    if standardize == "all":
        # Standardising a*x + b gives the same values as standardising x, for any a > 0.
        return (
            "Every model downstream standardises its inputs on the train rows, which undoes "
            "any scaling done here."
        )
    if family == "tree_ensemble":
        return "Only tree models are downstream. They split on rank order, which scaling keeps."
    return None


def _no_scaling(
    family: str | None, standardize: str | None, no_effect: str | None
) -> dict[str, Any]:
    if no_effect:
        # Leaving the step as it is changes no graph, so this choice has no params.
        return {"id": "none_tree_models", "applicability": "applicable", "reason": no_effect}
    if standardize is None:
        why = "Scaling may matter: no model is downstream of this step yet."
    elif standardize == "none" and family not in (None, "mixed"):
        why = f"The {family} model downstream takes its inputs as they are, so scaling matters."
    else:
        why = "Not every model downstream standardises its inputs, so scaling matters."
    return not_applicable("none_tree_models", why)
