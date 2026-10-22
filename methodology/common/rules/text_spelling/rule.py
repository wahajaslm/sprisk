"""Which text columns are trimmed and lowercased before the split (ADR-0059).

Values that differ only in spaces or case ('Paris', 'paris ') are one category typed two ways.
Trimming and lowercasing fit nothing, so a step before the split does it on all rows; blank
values stay as they are. Accents are not removed, since 'año' and 'ano' differ. The target,
the unit and time columns, and columns that look like identifiers are never changed without
asking: lowercasing an ID could merge two entities.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    input_columns,
    needs_fact,
    not_applicable,
    profile_evidence,
    profile_number,
)


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    target = authoritative(facts.get("question.target"))
    keys = {authoritative(facts.get(f"question.{n}")) for n in ("entity_column", "time_column")}
    rows = profile_number(observation, "input.rows")
    cased: dict[str, int] = {}
    accented: dict[str, int] = {}
    for column in input_columns(observation):
        case = profile_number(observation, f"input.column.{column}.case_variants")
        accent = profile_number(observation, f"input.column.{column}.accent_variants")
        if case:
            cased[column] = int(case)
        if accent:
            accented[column] = int(accent)
    evidence = [
        profile_evidence(f"{c} values differing only in spaces or case", str(n))
        for c, n in cased.items()
    ] + [
        profile_evidence(f"{c} values differing only in accents", str(n))
        for c, n in accented.items()
    ]

    def identifies(column: str) -> bool:
        distinct = profile_number(observation, f"input.column.{column}.distinct")
        share = observation.settings["identifier_share"]
        return column in keys or (
            rows is not None and distinct is not None and distinct >= share * rows
        )

    columns = [c for c in cased if c != target and not identifies(c)]
    asks = []
    if target in cased:
        asks.append(
            f"The target {target} has labels that differ only in spaces or case; say whether "
            "they are one class."
        )
    if held := [c for c in cased if c != target and identifies(c)]:
        asks.append(
            f"{', '.join(held)}: values differ only in spaces or case, but the column identifies "
            "rows; say whether they are the same."
        )
    if others := [c for c in accented if c != target]:
        asks.append(f"{', '.join(others)}: values differ only in accents; say if they are one.")
    question = " ".join(asks)

    if columns:
        normalise = applicable(
            "normalise",
            f"{', '.join(columns)}: values differ only in spaces or case, so one category is "
            "typed several ways.",
            {"columns": columns, "lowercase": True, "empty_to_null": False},
        )
        keep = (
            needs_fact("keep", question)
            if question
            else not_applicable("keep", "The same category would stay split.")
        )
        return decision(observation, "normalise", [normalise, keep], evidence)
    normalise = not_applicable("normalise", "No feature column differs only in spaces or case.")
    keep = (
        needs_fact("keep", question)
        if question
        else applicable("keep", "No text column differs only in spaces or case.", {})
    )
    return decision(observation, "keep", [normalise, keep], evidence)
