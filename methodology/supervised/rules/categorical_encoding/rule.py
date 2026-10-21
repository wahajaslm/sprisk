"""Which text columns reaching a model are encoded, and how (ADR-0056, ADR-0057).

A model fits only the model, so a category must become numbers before it. A column with few
categories gets one 0/1 column per category, learnt from the train rows, in a step added
before the model. One with many would make too many columns, so it is named and left out:
no step turns it into numbers yet. Target encoding leaks without cross-fitting, and ordinal
codes invent an order, so neither is offered.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    measure,
    not_applicable,
    profile_evidence,
    required,
    step_columns,
)

CATEGORY_TYPES = ("String", "Utf8", "Categorical", "Enum", "Boolean")


def decide(observation: RuleObservation) -> RuleDecision:
    limit = observation.settings["high_cardinality_threshold"]
    categories = [
        c
        for c in step_columns(observation)
        if str(measure(observation, c, "data_type")).startswith(CATEGORY_TYPES)
    ]
    distinct = {c: int(required(observation, c, "distinct")) for c in categories}
    few = [c for c in categories if distinct[c] <= limit]
    many = [c for c in categories if distinct[c] > limit]
    left_out = (
        f"{', '.join(f'{c} ({distinct[c]} categories)' for c in many)}: too many for one 0/1 "
        "column each. Leave them out with a Select columns step; no step turns them into "
        "numbers yet."
    )

    if few:
        reason = (
            f"{', '.join(few)}: at most {limit} categories each, so one 0/1 column per "
            "category stays small and invents no order."
        )
        one_hot = applicable(
            "one_hot_encoding",
            f"{reason} Left out: {left_out}" if many else reason,
            {"columns": few},
        )
    else:
        one_hot = not_applicable(
            "one_hot_encoding", left_out if many else "No category reaches the model."
        )
    no_encoding = (
        not_applicable(
            "no_encoding",
            f"{', '.join(categories)} would reach the model as categories, which it refuses.",
        )
        if categories
        else applicable("no_encoding", "Every column the model reads is a number.", {})
    )
    target = not_applicable(
        "target_encoding_oof",
        "No step for it yet. A category's target mean leaks the target unless each fold "
        "learns it without its own rows (Micci-Barreca 2001).",
    )
    ordinal = not_applicable(
        "ordinal_encoding",
        "No step for it yet. Integer codes give categories an order they do not have.",
    )

    evidence = [profile_evidence(f"{c} categories", str(distinct[c])) for c in categories]
    recommended = "one_hot_encoding" if few else "no_encoding"
    alternatives: list[dict[str, Any]] = [one_hot, no_encoding, target, ordinal]
    return decision(observation, recommended, alternatives, evidence)
