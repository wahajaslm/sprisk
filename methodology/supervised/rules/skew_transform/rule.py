"""Whether skewed numbers reaching a linear model are power transformed first (ADR-0057).

A long tail lets a few large values pull a linear fit. A step added before the model fits
Yeo-Johnson on the train rows and applies it to both, as scikit-learn's PowerTransformer
does. Only numbers past the skewness threshold are transformed, and never a 0/1 column:
a rare 1 makes it skewed, but transforming it changes nothing. The rule serves linear
models only; a tree splits on order, which the transform keeps.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    is_numeric,
    measured,
    not_applicable,
    profile_evidence,
    required,
    step_columns,
)


def decide(observation: RuleObservation) -> RuleDecision:
    limit = observation.settings["skewness_threshold"]
    skewness = {
        c: s
        for c in step_columns(observation)
        if is_numeric(observation, c)
        and required(observation, c, "distinct") > 2
        and (s := measured(observation, c, "skewness")) is not None
    }
    skewed = [c for c, s in skewness.items() if abs(s) > limit]

    if skewed:
        transform = applicable(
            "yeo_johnson",
            f"{', '.join(f'{c} ({skewness[c]:.2f})' for c in skewed)}: skewness past "
            f"{limit}. Yeo-Johnson, fit on the train rows, makes each close to symmetric.",
            {"columns": skewed},
        )
        none = not_applicable("no_transform", f"{', '.join(skewed)} have a long tail.")
    else:
        transform = not_applicable("yeo_johnson", f"No number has skewness past {limit}.")
        none = applicable("no_transform", f"No number has skewness past {limit}.", {})

    evidence = [profile_evidence(f"{c} skewness", str(s)) for c, s in skewness.items()]
    alternatives: list[dict[str, Any]] = [transform, none]
    return decision(
        observation, "yeo_johnson" if skewed else "no_transform", alternatives, evidence
    )
