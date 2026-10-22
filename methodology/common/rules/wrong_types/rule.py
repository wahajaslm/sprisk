"""Which text columns are numbers stored as text and are cast before the split (ADR-0059).

As text, a model treats each number as its own category. A column is cast only when every
present value reads as a number. When some do not, the rule names them: placeholders like "?"
are the markers rule's to mark, and numbers written with a comma ("1,000", "2,5") need a person
to say what the comma means. Codes with leading zeros (postal codes) read as numbers but are
labels, so they stay text. Casting fits nothing, so it may run on all rows.
"""

import re

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    input_columns,
    input_number,
    input_values,
    needs_fact,
    not_applicable,
    profile_evidence,
)

COMMA_NUMBER = re.compile(r"^\s*[+-]?\d[\d,]*(\.\d+)?\s*$")


def decide(observation: RuleObservation) -> RuleDecision:
    cast: list[str] = []
    codes: list[str] = []
    notes: list[str] = []
    shares: dict[str, float] = {}
    for column in input_columns(observation):
        share = input_number(observation, f"column.{column}.numeric_share")
        if share is None or share < observation.settings["mixed_min_share"]:
            continue
        shares[column] = share
        if share < 1.0:
            notes.append(_why_not(column, input_values(observation, column, "unconverted")))
        elif input_number(observation, f"column.{column}.leading_zero_values"):
            codes.append(column)
        else:
            cast.append(column)
    if codes:
        notes.append(f"{', '.join(codes)}: numbers with leading zeros, like codes; kept as text.")
    note = " ".join(notes)
    evidence = [
        profile_evidence(f"{c} share read as numbers", f"{share:.0%}")
        for c, share in shares.items()
    ]
    if cast:
        chosen = applicable(
            "cast",
            f"{', '.join(cast)}: every value reads as a number, but the column is text. " + note,
            {"columns": cast},
        )
        keep = not_applicable("keep", "As text, a model would treat each number as a category.")
        return decision(observation, "cast", [chosen, keep], evidence)
    nothing = not_applicable("cast", "No text column reads as numbers in full.")
    keep = (
        needs_fact("keep", note)
        if note
        else applicable("keep", "No text column is numbers stored as text.", {})
    )
    return decision(observation, "keep", [nothing, keep], evidence)


def _why_not(column: str, values: list[str]) -> str:
    shown = ", ".join(repr(v) for v in values)
    if values and all(COMMA_NUMBER.match(v) for v in values):
        return (
            f"{column}: {shown} look like numbers written with a comma; say whether it "
            "separates thousands or decimals."
        )
    return (
        f"{column}: {shown} do not read as numbers. Placeholders are marked missing by the "
        "markers rule; otherwise say what they are."
    )
