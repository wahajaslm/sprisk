"""Whether a date reaching a model is split into parts first (ADR-0056, ADR-0057).

A model reads only numbers, and a date is not one. A step added before the model puts the
year, month and weekday in its place, with month and weekday also on a circle so December
sits next to January. Each row is worked out on its own, so nothing is learned.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    measure,
    not_applicable,
    profile_evidence,
    step_columns,
)

# Datetime(...) starts with Date too.
DATE_TYPE = "Date"


def decide(observation: RuleObservation) -> RuleDecision:
    data_type = {c: str(measure(observation, c, "data_type")) for c in step_columns(observation)}
    dates = [c for c, t in data_type.items() if t.startswith(DATE_TYPE)]

    if dates:
        parts = applicable(
            "date_parts",
            f"{', '.join(dates)}: a date would reach the model, which reads only numbers.",
            {"columns": dates},
        )
        none = not_applicable("no_dates", f"{', '.join(dates)} would reach the model as dates.")
    else:
        parts = not_applicable("date_parts", "No date reaches the model.")
        none = applicable("no_dates", "No date reaches the model.", {})

    evidence = [profile_evidence(f"{c} type", data_type[c]) for c in dates]
    alternatives: list[dict[str, Any]] = [parts, none]
    return decision(observation, "date_parts" if dates else "no_dates", alternatives, evidence)
