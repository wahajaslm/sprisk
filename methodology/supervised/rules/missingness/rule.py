"""How a step fills or drops gaps, from the train rows' measured missing shares (ADR-0042).

Fills are fit on train rows only (the impute step's train/test ports). A target is never
filled, and text cannot be imputed yet, so either means dropping rows.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    is_numeric,
    measured,
    not_applicable,
    profile_evidence,
    required,
    step_columns,
)


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    columns = step_columns(observation)
    target = authoritative(observation.facts.get("question.target"))
    share = {c: required(observation, c, "missing_share") for c in columns}
    # A numeric column without a skew has no variation: mean and median are the same.
    skew = {c: abs(v) for c in columns if (v := measured(observation, c, "skewness")) is not None}

    has_target = target in columns
    text = [c for c in columns if not is_numeric(observation, c)]
    mostly_empty = [c for c in columns if share[c] >= s["drop_column_threshold"]]
    skewed = any(v > s["skewness_threshold"] for v in skew.values())

    blocked = (
        f"{target} is the target: a missing label must never be filled."
        if has_target
        else f"The impute step fills numbers only; {', '.join(text)} is text."
        if text
        else None
    )
    median = _impute(
        "impute_median",
        "Some columns are skewed, which pulls the mean; the median is robust to that.",
        "median",
        columns,
        blocked,
    )
    mean = _impute(
        "impute_mean",
        "Values are roughly symmetric. A mean fill shrinks variance as the gap grows.",
        "mean",
        columns,
        blocked,
    )
    drop_rows = applicable(
        "drop_rows",
        blocked or "Drops each row with a gap. Simple, but it shrinks and may bias the data.",
        {"columns": columns},
    )
    mode = not_applicable("impute_mode", "The impute step fills numbers only (ADR-0042).")
    drop_column = not_applicable(
        "drop_column",
        (
            f"{', '.join(mostly_empty)} is at least {s['drop_column_threshold']:.0%} empty. "
            "Drop it with a select step before the split; this step cannot."
        )
        if mostly_empty
        else "No column is mostly empty.",
    )
    pass_through = not_applicable(
        "pass_through", "Needs the planned model family, which the question does not record."
    )

    if blocked:
        recommended = "drop_rows"
    elif skewed:
        recommended = "impute_median"
    else:
        recommended = "impute_mean"

    evidence = [profile_evidence(f"{c} missing share", f"{share[c]:.1%}") for c in columns]
    return decision(
        observation,
        recommended,
        [drop_rows, median, mean, mode, drop_column, pass_through],
        evidence,
    )


def _impute(
    id: str, reason: str, method: str, columns: list[str], blocked: str | None
) -> dict[str, Any]:
    if blocked:
        return not_applicable(id, blocked)
    return applicable(id, reason, {"columns": columns, "method": method})
