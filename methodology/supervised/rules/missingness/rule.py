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
    needs_fact,
    not_applicable,
    other_readers,
    profile_evidence,
    question_evidence,
    required,
    step_columns,
)

FILL_GAPS = "flow.models_fill_gaps"


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    fills = flow_fact(observation, FILL_GAPS)
    columns = step_columns(observation)
    target_fact = observation.facts.get("question.target")
    target = authoritative(target_fact)
    # An inferred target only asks: until it is confirmed, no fill may touch it.
    maybe_target = target_fact.value if target_fact and target is None else None
    share = {c: required(observation, c, "missing_share") for c in columns}
    # A numeric column without a skew has no variation: mean and median are the same.
    skew = {c: abs(v) for c in columns if (v := measured(observation, c, "skewness")) is not None}

    has_target = target in columns
    may_be_target = maybe_target in columns
    confirm = (
        f"Confirm the target first: if {maybe_target} is the target, a missing label must "
        "never be filled."
    )
    text = [c for c in columns if not is_numeric(observation, c)]
    mostly_empty = [c for c in columns if share[c] >= s["drop_column_threshold"]]
    skewed = any(v > s["skewness_threshold"] for v in skew.values())

    target_gaps = f"{target} is the target: a missing label must never be filled."
    text_gaps = f"The impute step fills numbers only; {', '.join(text)} is text."
    blocked = target_gaps if has_target else text_gaps if text else None
    ask = confirm if may_be_target else None
    median = _impute(
        "impute_median",
        "Some columns are skewed, which pulls the mean; the median is robust to that.",
        "median",
        columns,
        blocked,
        ask,
    )
    mean = _impute(
        "impute_mean",
        "Values are roughly symmetric. A mean fill shrinks variance as the gap grows.",
        "mean",
        columns,
        blocked,
        ask,
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
    readers = other_readers(observation)
    if has_target:
        pass_through = not_applicable("pass_through", target_gaps)
    elif ask:
        pass_through = needs_fact("pass_through", ask)
    elif readers:
        pass_through = not_applicable("pass_through", readers)
    else:
        pass_through = _pass_through(fills, flow_fact(observation, "step.method"))

    if has_target or may_be_target:
        recommended = "drop_rows"
    elif pass_through["applicability"] == "applicable":
        recommended = "pass_through"
    elif text:
        recommended = "drop_rows"
    elif skewed:
        recommended = "impute_median"
    else:
        recommended = "impute_mean"

    evidence = flow_evidence(observation, [FILL_GAPS, "flow.other_readers", "step.method"])
    if target_fact and target_fact.value in columns:
        evidence += question_evidence(observation, {"question.target": "Target"})
    evidence += [profile_evidence(f"{c} missing share", f"{share[c]:.1%}") for c in columns]
    return decision(
        observation,
        recommended,
        [drop_rows, median, mean, mode, drop_column, pass_through],
        evidence,
    )


def _impute(
    id: str, reason: str, method: str, columns: list[str], blocked: str | None, ask: str | None
) -> dict[str, Any]:
    if blocked:
        return not_applicable(id, blocked)
    if ask:
        return needs_fact(id, ask)
    return applicable(id, reason, {"columns": columns, "method": method})


def _pass_through(fills: str | None, method: str | None) -> dict[str, Any]:
    if fills == "all":
        if method == "zero":
            return needs_fact(
                "pass_through",
                "This step fills gaps with zero, which may mean 'none' here. Confirm that the "
                "models' own fill may replace it.",
            )
        then = (
            f"its own fill replaces this step's {method} fill."
            if method
            else "rows with gaps are kept for it to fill."
        )
        # Removing the step needs no params (ADR-0043).
        return {
            "id": "pass_through",
            "applicability": "applicable",
            "reason": "Every model downstream fills gaps itself, fit on its train rows only; "
            + then,
        }
    if fills is None:
        why = "Nothing would fill the gaps: no model is downstream of this step yet."
    elif fills == "none":
        why = "No model downstream is known to fill gaps itself; fill them here."
    else:
        why = "Not every model downstream is known to fill gaps itself; fill them here."
    return not_applicable("pass_through", why)
