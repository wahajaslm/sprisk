"""Which text columns are trimmed and lowercased before the split (ADR-0059).

Values that differ only in spaces or case ('Paris', 'paris ') are one category typed two ways.
Trimming and lowercasing fit nothing, so a step before the split does it on all rows. Accents
are not removed, since 'año' and 'ano' differ; such values are named and asked about. The
target's labels are never changed here.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    input_columns,
    needs_fact,
    not_applicable,
    profile_evidence,
    profile_number,
)


def decide(observation: RuleObservation) -> RuleDecision:
    target_fact = observation.facts.get("question.target")
    target = target_fact.value if target_fact is not None else None
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
    asks = []
    if target in cased:
        asks.append(
            f"The target {target} has labels that differ only in spaces or case; say whether "
            "they are one class."
        )
    if others := [c for c in accented if c != target]:
        asks.append(f"{', '.join(others)}: values differ only in accents; say if they are one.")
    question = " ".join(asks)

    columns = [c for c in cased if c != target]
    if columns:
        normalise = applicable(
            "normalise",
            f"{', '.join(columns)}: values differ only in spaces or case, so one category is "
            "typed several ways.",
            {"columns": columns, "lowercase": True},
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
