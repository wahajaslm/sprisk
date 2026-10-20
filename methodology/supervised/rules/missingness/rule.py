"""How a step fills or drops gaps, from the train rows' measured missing shares (ADR-0042).

Fills are fit on train rows only (the impute step's train/test ports). A target is never
filled, and text cannot be imputed yet, so either means dropping rows. When every model
downstream fills gaps itself, fit on its train rows, gaps can pass, text included.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    flow_evidence,
    flow_fact,
    is_numeric,
    measured,
    not_applicable,
    profile_evidence,
    required,
    step_columns,
)

FILL_GAPS = "flow.models_fill_gaps"


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    fills = flow_fact(observation, FILL_GAPS)
    columns = step_columns(observation)
    target = authoritative(observation.facts.get("question.target"))
    share = {c: required(observation, c, "missing_share") for c in columns}
    # A numeric column without a skew has no variation: mean and median are the same.
    skew = {c: abs(v) for c in columns if (v := measured(observation, c, "skewness")) is not None}

    has_target = target in columns
    text = [c for c in columns if not is_numeric(observation, c)]
    mostly_empty = [c for c in columns if share[c] >= s["drop_column_threshold"]]
    skewed = any(v > s["skewness_threshold"] for v in skew.values())

    target_gaps = f"{target} is the target: a missing label must never be filled."
    text_gaps = f"The impute step fills numbers only; {', '.join(text)} is text."
    blocked = target_gaps if has_target else text_gaps if text else None
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
        target_gaps
        if has_target
        else text_gaps
        if text and fills != "all"
        else "Drops each row with a gap. Simple, but it shrinks and may bias the data.",
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
    pass_through = _pass_through(fills, target_gaps if has_target else None)

    if has_target:
        recommended = "drop_rows"
    elif fills == "all":
        recommended = "pass_through"
    elif text:
        recommended = "drop_rows"
    elif skewed:
        recommended = "impute_median"
    else:
        recommended = "impute_mean"

    evidence = flow_evidence(observation, [FILL_GAPS])
    evidence += [profile_evidence(f"{c} missing share", f"{share[c]:.1%}") for c in columns]
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


def _pass_through(fills: str | None, target_gaps: str | None) -> dict[str, Any]:
    if target_gaps:
        return not_applicable("pass_through", target_gaps)
    if fills == "all":
        # Leaving the step as it is changes no graph, so this choice has no params.
        return {
            "id": "pass_through",
            "applicability": "applicable",
            "reason": "Every model downstream fills gaps itself, fit on its train rows only.",
        }
    if fills is None:
        return not_applicable(
            "pass_through", "Nothing would fill the gaps: no model is downstream of this step yet."
        )
    return not_applicable(
        "pass_through", "Some models downstream do not fill gaps themselves; fill them here."
    )
