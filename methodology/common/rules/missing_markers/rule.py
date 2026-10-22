"""Which placeholder values in mostly numeric text columns become missing (ADR-0059).

A column of numbers with a few "?" or "n/a" in it is read as text, so a model treats every
number as its own category. Only whole values on a known list of placeholders are marked, in a
step added before the split; marking fits nothing, so it may run on all rows. Other leftovers,
such as "NA", may be real values (a country code), so the rule names them and asks.
"""

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


def decide(observation: RuleObservation) -> RuleDecision:
    settings = observation.settings
    known = set(settings["known_markers"])
    seen: dict[str, list[str]] = {}
    for column in input_columns(observation):
        share = input_number(observation, f"column.{column}.numeric_share")
        values = input_values(observation, column, "unconverted")
        if share is None or share < settings["min_numeric_share"]:
            continue
        if values and len(values) <= settings["max_marker_values"]:
            seen[column] = values
    # Matched without spaces, marked as written: mark_missing matches whole values.
    marked = {c: [v for v in vs if v.strip() in known] for c, vs in seen.items()}
    marked = {c: vs for c, vs in marked.items() if vs}
    unknown = {c: [v for v in vs if v.strip() not in known] for c, vs in seen.items()}
    asked = "; ".join(f"{c}: {', '.join(repr(v) for v in vs)}" for c, vs in unknown.items() if vs)
    question = f"Each may be a real value, so it is not marked: {asked}. Say if it means missing."
    evidence = [
        profile_evidence(f"{c} values that are not numbers", ", ".join(repr(v) for v in vs))
        for c, vs in seen.items()
    ]

    if marked:
        values = sorted({v for vs in marked.values() for v in vs})
        mark = applicable(
            "mark",
            f"{', '.join(marked)}: mostly numbers, with placeholders "
            f"{', '.join(repr(v) for v in values)} that stand for a gap.",
            {"columns": list(marked), "values": values},
        )
        keep = (
            needs_fact("keep", question)
            if asked
            else not_applicable("keep", "Placeholders would stay text and hide the numbers.")
        )
        return decision(observation, "mark", [mark, keep], evidence)

    mark = not_applicable("mark", "No mostly numeric text column holds a known placeholder.")
    keep = (
        needs_fact("keep", question)
        if asked
        else applicable("keep", "No mostly numeric text column holds a placeholder.", {})
    )
    return decision(observation, "keep", [mark, keep], evidence)
