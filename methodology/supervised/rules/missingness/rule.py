"""How a step fills or drops gaps, from the train rows' measured missing shares (ADR-0042).

Fills are fit on train rows only (the impute step's train/test ports). Text gaps get the
category "missing", so a gap keeps its own meaning. A target is never filled, and a column
neither number nor text (a date, true/false) cannot be, so either means dropping rows. A model
fits only the model and refuses gaps (ADR-0056), so every gap is filled or dropped here.
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
    measure,
    measured,
    needs_fact,
    not_applicable,
    profile_evidence,
    question_evidence,
    required,
    step_columns,
)

TEXT_TYPES = ("String", "Utf8", "Categorical")
TEXT_FILL = "missing"


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
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
    text = [c for c in columns if str(measure(observation, c, "data_type")).startswith(TEXT_TYPES)]
    other = [c for c in columns if not is_numeric(observation, c) and c not in text]
    mostly_empty = [c for c in columns if share[c] >= s["drop_column_threshold"]]
    skewed = any(v > s["skewness_threshold"] for v in skew.values())

    target_gaps = f"{target} is the target: a missing label must never be filled."
    other_gaps = f"The impute step fills numbers and text only; {', '.join(other)} is neither."
    blocked = target_gaps if has_target else other_gaps if other else None
    text_note = f" {', '.join(text)}: gaps become the category {TEXT_FILL!r}." if text else ""
    text_params = {"text_fill": TEXT_FILL} if text else {}
    ask = confirm if may_be_target else None
    method_now = flow_fact(observation, "step.method")

    def asks(method: str) -> str | None:
        if ask:
            return ask
        if method_now == "zero":
            return (
                "This step fills gaps with zero, which may mean 'none' here. Confirm that a "
                f"{method} fill may replace it."
            )
        return None

    median = _impute(
        "impute_median",
        "Some columns are skewed, which pulls the mean; the median is robust to that." + text_note,
        {"columns": columns, "method": "median", **text_params},
        blocked,
        asks("median"),
    )
    mean = _impute(
        "impute_mean",
        "Values are roughly symmetric. A mean fill shrinks variance as the gap grows." + text_note,
        {"columns": columns, "method": "mean", **text_params},
        blocked,
        asks("mean"),
    )
    drop_rows = applicable(
        "drop_rows",
        target_gaps
        if has_target
        else other_gaps
        if other
        else "Drops each row with a gap. Simple, but it shrinks and may bias the data.",
        {"columns": columns},
    )
    mode = not_applicable(
        "impute_mode",
        f"A most-frequent fill gives a gap a value it never had; text gaps get {TEXT_FILL!r}.",
    )
    drop_column = not_applicable(
        "drop_column",
        (
            f"{', '.join(mostly_empty)} is at least {s['drop_column_threshold']:.0%} empty. "
            "Drop it with a select step before the split; this step cannot."
        )
        if mostly_empty
        else "No column is mostly empty.",
    )

    if has_target or may_be_target or other:
        recommended = "drop_rows"
    elif skewed:
        recommended = "impute_median"
    else:
        recommended = "impute_mean"

    evidence = flow_evidence(observation, ["step.method"])
    if target_fact and target_fact.value in columns:
        evidence += question_evidence(observation, {"question.target": "Target"})
    evidence += [profile_evidence(f"{c} missing share", f"{share[c]:.1%}") for c in columns]
    return decision(
        observation,
        recommended,
        [drop_rows, median, mean, mode, drop_column],
        evidence,
    )


def _impute(
    id: str, reason: str, params: dict[str, Any], blocked: str | None, ask: str | None
) -> dict[str, Any]:
    if blocked:
        return not_applicable(id, blocked)
    if ask:
        return needs_fact(id, ask)
    return applicable(id, reason, params)
