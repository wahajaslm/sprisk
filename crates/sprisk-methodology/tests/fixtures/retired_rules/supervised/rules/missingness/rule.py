"""How a step fills or drops gaps, from the train rows' measured missing shares (ADR-0042).

Fills are fit on train rows only (the impute step's train/test ports). A gap in text with few
values becomes a category of its own (a setting, "missing"); one in free text, with more
values than the encoding limit, becomes empty text, no words (a setting, ""). A target is
never filled, and a column neither number nor text (a date, true/false) cannot be, so either
means dropping rows. A model fits only the model and refuses gaps (ADR-0056), so every gap is
filled or dropped here.
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
# The routes of each kind of subject; the other kind's are never this step's.
FILL_ALTERNATIVES = ("drop_rows", "impute_median", "impute_mean", "impute_mode", "drop_column")
MODEL_ALTERNATIVES = ("fill_before_model", "no_gaps", "gaps_left")


def decide(observation: RuleObservation) -> RuleDecision:
    # Only a model step states its task: the rule decides what reaches it.
    if flow_fact(observation, "step.task") is not None:
        return _before_model(observation)
    s = observation.settings
    columns = step_columns(observation)
    target_fact = observation.facts.get("question.target")
    target = authoritative(target_fact)
    # An inferred target only asks: until it is confirmed, no fill may touch it.
    maybe_target = target_fact.value if target_fact and target is None else None
    share = {c: required(observation, c, "missing_share") for c in columns}

    has_target = target in columns
    may_be_target = maybe_target in columns
    confirm = (
        f"Confirm the target first: if {maybe_target} is the target, a missing label must "
        "never be filled."
    )
    text = _text_columns(observation, columns)
    other = [c for c in columns if not is_numeric(observation, c) and c not in text]
    mostly_empty = [c for c in columns if share[c] >= s["drop_column_threshold"]]
    skewed = _fill_method(observation, columns) == "median"

    target_gaps = f"{target} is the target: a missing label must never be filled."
    other_gaps = f"The impute step fills numbers and text only; {', '.join(other)} is neither."
    blocked = target_gaps if has_target else other_gaps if other else None
    text_fill = {c: _text_fill(observation, c) for c in text}
    text_note = "".join(f" {c}: gaps become {fill!r}." for c, fill in text_fill.items())
    text_params = {"text_fill": text_fill} if text else {}
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
        "A most-frequent fill gives a gap a value it never had; text gaps get their own value.",
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
    model_only = "This decides what reaches a model; the step is a fill step."
    return decision(
        observation,
        recommended,
        [
            drop_rows,
            median,
            mean,
            mode,
            drop_column,
            *(not_applicable(a, model_only) for a in MODEL_ALTERNATIVES),
        ],
        evidence,
    )


def _before_model(observation: RuleObservation) -> RuleDecision:
    """Gaps in the columns a model reads (its train rows, the target and keys left out) are
    filled in an impute step added before it, the method chosen as for a fill step. A mostly
    empty column is not filled: most of its values would be made up."""
    s = observation.settings
    columns = step_columns(observation)
    share = {c: required(observation, c, "missing_share") for c in columns}
    gappy = [c for c in columns if share[c] > 0]
    text = _text_columns(observation, gappy)
    mostly_empty = [c for c in gappy if share[c] >= s["drop_column_threshold"]]
    unfillable = [c for c in gappy if c not in text and not is_numeric(observation, c)]
    fillable = [c for c in gappy if c not in mostly_empty and c not in unfillable]
    left = " ".join(
        part
        for part in (
            f"{', '.join(unfillable)} has gaps, and the impute step fills numbers and text only."
            if unfillable
            else "",
            f"{', '.join(mostly_empty)} is at least {s['drop_column_threshold']:.0%} empty: "
            "leave it out with a select step before the split rather than make up most of it."
            if mostly_empty
            else "",
        )
        if part
    )

    if fillable:
        method = _fill_method(observation, fillable)
        text_fill = {c: _text_fill(observation, c) for c in text if c in fillable}
        filled = (
            f"{', '.join(fillable)} has gaps the model would refuse: filled with the train "
            f"rows' {method}" + (", text with its own value." if text_fill else ".")
        )
        fill = applicable(
            "fill_before_model",
            " ".join(part for part in (filled, left) if part),
            {
                "columns": fillable,
                "method": method,
                **({"text_fill": text_fill} if text_fill else {}),
            },
        )
    else:
        fill = not_applicable("fill_before_model", left or "No column the model reads has gaps.")
    none = (
        not_applicable("no_gaps", f"{', '.join(gappy)} has gaps.")
        if gappy
        else applicable("no_gaps", "No column the model reads has gaps.", {})
    )
    stuck = (
        applicable("gaps_left", left, {})
        if left
        else not_applicable("gaps_left", "Every gap can be filled.")
    )
    recommended = "fill_before_model" if fillable else "gaps_left" if left else "no_gaps"
    fill_only = "This decides a fill step; the step is a model."
    alternatives = [
        fill,
        none,
        stuck,
        *(not_applicable(a, fill_only) for a in FILL_ALTERNATIVES),
    ]
    evidence = flow_evidence(observation, ["step.task"])
    evidence += [profile_evidence(f"{c} missing share", f"{share[c]:.1%}") for c in gappy]
    return decision(observation, recommended, alternatives, evidence)


def _text_columns(observation: RuleObservation, columns: list[str]) -> list[str]:
    return [c for c in columns if str(measure(observation, c, "data_type")).startswith(TEXT_TYPES)]


def _fill_method(observation: RuleObservation, columns: list[str]) -> str:
    """Median when any of `columns` is skewed, which pulls the mean; else mean. A numeric
    column without a skew has no variation: mean and median are the same."""
    skewed = any(
        abs(v) > observation.settings["skewness_threshold"]
        for c in columns
        if (v := measured(observation, c, "skewness")) is not None
    )
    return "median" if skewed else "mean"


def _text_fill(observation: RuleObservation, column: str) -> str:
    """A category's gap is a category of its own; free text's is empty text, no words: a word
    such as "missing" would be read as the word in other rows."""
    s = observation.settings
    few = required(observation, column, "distinct") <= s["high_cardinality_threshold"]
    return str(s["category_text_fill"] if few else s["free_text_fill"])


def _impute(
    id: str, reason: str, params: dict[str, Any], blocked: str | None, ask: str | None
) -> dict[str, Any]:
    if blocked:
        return not_applicable(id, blocked)
    if ask:
        return needs_fact(id, ask)
    return applicable(id, reason, params)
