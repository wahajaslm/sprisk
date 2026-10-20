"""Which scaling a step uses, from the train rows' measured tails (ADR-0042).

Heavy tails or outliers distort the mean and SD, so they get median and IQR scaling.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    is_numeric,
    measured,
    not_applicable,
    profile_evidence,
    step_columns,
)


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
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
    trees = not_applicable(
        "none_tree_models", "Needs the planned model family, which the question does not record."
    )
    maxabs = not_applicable("maxabs_scaling_sparse", "The scale step has no max-abs method.")

    evidence = [profile_evidence(f"{c} excess kurtosis", f"{v:.2f}") for c, v in kurtosis.items()]
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in outliers.items()]
    return decision(
        observation,
        "robust_scaling" if heavy else "standard_scaling",
        [trees, robust, standard, maxabs],
        evidence,
    )
