"""Which scaling a step uses, from the models downstream and the train rows' tails (ADR-0042).

Trees split on rank order, so scaling changes nothing for them. Otherwise heavy tails or
outliers distort the mean and SD, so they get median and IQR scaling.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    family_evidence,
    is_numeric,
    measured,
    model_family,
    not_applicable,
    profile_evidence,
    step_columns,
    unknown_family,
)


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    family = model_family(observation)
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

    if text or flat:
        why = (
            f"The scale step needs numbers; {', '.join(text)} is text."
            if text
            else f"{', '.join(flat)} has no spread in the train rows, so it cannot be scaled."
        )
        robust = not_applicable("robust_scaling", why)
        standard = not_applicable("standard_scaling", why)
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
    if family == "tree_ensemble":
        # Leaving the step as it is changes no graph, so this choice has no params.
        trees = {
            "id": "none_tree_models",
            "applicability": "applicable",
            "reason": "Only tree models are downstream. They split on rank order, which "
            "scaling does not change.",
        }
    elif family in (None, "mixed"):
        trees = not_applicable("none_tree_models", unknown_family(family))
    else:
        trees = not_applicable(
            "none_tree_models", f"The model downstream is {family}, not a tree ensemble."
        )
    maxabs = not_applicable("maxabs_scaling_sparse", "The scale step has no max-abs method.")

    evidence = family_evidence(family)
    evidence += [profile_evidence(f"{c} excess kurtosis", f"{v:.2f}") for c, v in kurtosis.items()]
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in outliers.items()]
    if family == "tree_ensemble":
        recommended = "none_tree_models"
    elif heavy:
        recommended = "robust_scaling"
    else:
        recommended = "standard_scaling"
    return decision(
        observation,
        recommended,
        [trees, robust, standard, maxabs],
        evidence,
    )
