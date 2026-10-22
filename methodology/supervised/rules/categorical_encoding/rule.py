"""Which text columns reaching a model are encoded, and how (ADR-0056, ADR-0057).

A model fits only the model, so a category must become numbers before it. A column with few
categories gets one 0/1 column per category, learnt from the train rows, in a step added
before the model. One with many would make too many columns, so the model leaves it out (its
`exclude`): no step turns it into numbers yet. Target encoding leaks without cross-fitting,
and ordinal codes invent an order, so neither is offered.

Whole numbers with a few values may be category codes (a rate of 1 to 4); the rule cannot
tell codes from amounts, so it asks.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    flow_fact,
    measure,
    needs_fact,
    not_applicable,
    profile_evidence,
    required,
    step_columns,
)

CATEGORY_TYPES = ("String", "Utf8", "Categorical", "Enum", "Boolean")
WHOLE_NUMBER_TYPES = ("Int", "UInt")


def decide(observation: RuleObservation) -> RuleDecision:
    limit = observation.settings["high_cardinality_threshold"]
    columns = step_columns(observation)
    data_type = {c: str(measure(observation, c, "data_type")) for c in columns}
    categories = [c for c in columns if data_type[c].startswith(CATEGORY_TYPES)]
    whole = [c for c in columns if data_type[c].startswith(WHOLE_NUMBER_TYPES)]
    distinct = {c: int(required(observation, c, "distinct")) for c in categories + whole}
    few = [c for c in categories if distinct[c] <= limit]
    many = [c for c in categories if distinct[c] > limit]
    # Two values are one 0/1 column either way; more may be codes.
    least = observation.settings["min_code_values"]
    codes = [c for c in whole if least <= distinct[c] <= limit]
    too_many = (
        f"{', '.join(f'{c} ({distinct[c]} categories)' for c in many)}: too many for one 0/1 "
        "column each, and no step turns them into numbers yet."
    )

    if few:
        reason = (
            f"{', '.join(few)}: at most {limit} categories each, so one 0/1 column per "
            "category stays small and invents no order."
        )
        if _least_squares(observation):
            reason += (
                " Every category gets a column, so with the intercept least squares cannot "
                "tell their coefficients apart: its predictions hold, its coefficients must "
                "not be read."
            )
        one_hot = applicable(
            "one_hot_encoding",
            f"{reason} Left out: {too_many}" if many else reason,
            {"columns": few},
        )
    else:
        one_hot = not_applicable(
            "one_hot_encoding", too_many if many else "No category reaches the model."
        )
    leave_out = _leave_out(observation, many, too_many)
    if categories:
        no_encoding = not_applicable(
            "no_encoding",
            f"{', '.join(categories)} would reach the model as categories, which it refuses.",
        )
    elif codes:
        no_encoding = needs_fact(
            "no_encoding",
            f"Every column the model reads is a number, but {', '.join(codes)} may be category "
            "codes; read as amounts, their codes get an order and equal steps. Confirm they "
            "are amounts.",
        )
    else:
        no_encoding = applicable("no_encoding", "Every column the model reads is a number.", {})
    integer_codes = (
        needs_fact(
            "one_hot_integer_codes",
            f"{', '.join(f'{c} ({distinct[c]} values)' for c in codes)}: whole numbers with "
            "few values. If they name categories, not amounts, they need one 0/1 column each. "
            "Confirm which they are.",
        )
        if codes
        else not_applicable("one_hot_integer_codes", "No whole-number column has a few values.")
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
    evidence += [profile_evidence(f"{c} values", str(distinct[c])) for c in codes]
    recommended = "one_hot_encoding" if few else "leave_out_columns" if many else "no_encoding"
    alternatives: list[dict[str, Any]] = [
        one_hot,
        leave_out,
        no_encoding,
        integer_codes,
        target,
        ordinal,
    ]
    return decision(observation, recommended, alternatives, evidence)


def _leave_out(observation: RuleObservation, many: list[str], too_many: str) -> dict[str, Any]:
    """The model leaves `many` out, beside the columns it already leaves out. A model that
    lists its features reads only those, so they must be dropped from that list instead."""
    if not many:
        return not_applicable("leave_out_columns", "No column has too many categories.")
    if flow_fact(observation, "step.features") is not None:
        return not_applicable(
            "leave_out_columns",
            f"The model lists its features: remove {', '.join(many)} from them.",
        )
    excluded = flow_fact(observation, "step.exclude")
    already = excluded.split(", ") if excluded else []
    return applicable(
        "leave_out_columns",
        f"{too_many} The model leaves them out.",
        {"exclude": sorted({*already, *many})},
    )


def _least_squares(observation: RuleObservation) -> bool:
    """Plain linear regression: no penalty, so its coefficients are not unique when columns
    sum to its intercept. Logistic regression's penalty makes them unique."""
    families = flow_fact(observation, "flow.model_families") or ""
    return "linear" in families.split(", ") and flow_fact(observation, "step.task") == "regression"
