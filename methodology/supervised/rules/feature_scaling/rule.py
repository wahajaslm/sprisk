"""Which scaling a step uses, from the train rows' measured tails (ADR-0042).

Heavy tails or outliers distort the mean and SD, so they get median and IQR scaling.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    is_numeric,
    measure,
    not_applicable,
    profile_evidence,
    step_columns,
)


def decide(observation: RuleObservation) -> RuleDecision:
    cutoff = observation.settings["outlier_kurtosis_threshold"]
    columns = step_columns(observation)
    kurtosis = {c: float(measure(observation, c, "kurtosis") or 0.0) for c in columns}
    outliers = {c: float(measure(observation, c, "outlier_share") or 0.0) for c in columns}
    text = [c for c in columns if not is_numeric(observation, c)]
    heavy = [c for c in columns if kurtosis[c] > cutoff or outliers[c] > 0]

    if text:
        why = f"The scale step needs numbers; {', '.join(text)} is text."
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

    evidence = [profile_evidence(f"{c} excess kurtosis", f"{kurtosis[c]:.2f}") for c in columns]
    evidence += [profile_evidence(f"{c} outlier share", f"{outliers[c]:.1%}") for c in columns]
    return decision(
        observation,
        "robust_scaling" if heavy else "standard_scaling",
        [trees, robust, standard, maxabs],
        evidence,
    )
