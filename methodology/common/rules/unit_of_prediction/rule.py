"""Whether rows repeat the unit a prediction is about (ADR-0059).

The question names the unit and the column that identifies it. Counted on the rows the split
takes: as many distinct values as rows means one row per unit; fewer means units repeat, so the
split must group by the unit. A unit with no such column is taken as one per row, as the person
stated no way for it to repeat; with no unit at all, the rule asks.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    needs_fact,
    not_applicable,
    profile_evidence,
    profile_number,
    question_evidence,
)

LABELS = {"question.unit_of_analysis": "Unit", "question.entity_column": "Unit column"}


def decide(observation: RuleObservation) -> RuleDecision:
    evidence = question_evidence(observation, LABELS)
    unit = observation.facts.get("question.unit_of_analysis")
    entity_fact = observation.facts.get("question.entity_column")
    entity = entity_fact.value if entity_fact is not None else None
    rows = profile_number(observation, "input.rows")
    distinct = (
        None if entity is None else profile_number(observation, f"input.column.{entity}.distinct")
    )

    if entity is None and unit is not None and authoritative(unit) is not None:
        why = (
            f"The question names no column that identifies the {unit.value}, so each row is "
            f"one {unit.value}. Name the column if a {unit.value} can repeat."
        )
        return decision(observation, "one_row_per_unit", _pick("one_row_per_unit", why), evidence)
    if entity is None or rows is None or distinct is None:
        why = (
            "Say what one row stands for, and name the column that identifies it."
            if entity is None
            else f"The rows the split takes have no column {entity}."
        )
        return decision(observation, "one_row_per_unit", _ask(why), evidence)

    evidence.append(profile_evidence(f"Distinct {entity} before the split", str(int(distinct))))
    evidence.append(profile_evidence("Rows before the split", str(int(rows))))
    repeats = distinct < rows
    chosen = "keep_rows_group_split" if repeats else "one_row_per_unit"
    why = (
        f"{int(rows)} rows for {int(distinct)} values of {entity}: units repeat, so the split "
        f"groups by {entity}. Rows with no {entity} form one group."
        if repeats
        else f"Each of the {int(rows)} rows has its own {entity}."
    )
    if authoritative(entity_fact) is None:
        return decision(
            observation, chosen, _ask(f"Confirm {entity} identifies the unit. {why}"), evidence
        )
    return decision(observation, chosen, _pick(chosen, why), evidence)


def _pick(chosen: str, why: str) -> list[dict[str, Any]]:
    other = "keep_rows_group_split" if chosen == "one_row_per_unit" else "one_row_per_unit"
    return [applicable(chosen, why, {}), not_applicable(other, why), _aggregate()]


def _ask(why: str) -> list[dict[str, Any]]:
    return [
        needs_fact("one_row_per_unit", why),
        needs_fact("keep_rows_group_split", why),
        _aggregate(),
    ]


def _aggregate() -> dict[str, Any]:
    return not_applicable("aggregate", "No step aggregates rows to one per unit yet.")
