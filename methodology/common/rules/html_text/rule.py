"""Which text columns have their HTML stripped before the split (ADR-0059).

Scraped text often keeps its markup: "<br />" and "&eacute;". Counted as words, the markup
becomes words of its own ("br", "eacute") and splits "caf&eacute;" from "café". Stripping tags
and decoding entities fits nothing, so a step before the split does it on all rows. The target
and the unit and time columns are never changed: a label or a key with markup is left as it is.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    input_columns,
    not_applicable,
    profile_evidence,
    profile_number,
    required_number,
)

TEXT_TYPES = ("String", "Utf8")


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    # Even a guessed target or key is held: leaving a column as it is needs no confirmation.
    held = {
        f.value
        for n in ("target", "entity_column", "time_column")
        if (f := facts.get(f"question.{n}")) is not None
    }
    share: dict[str, float] = {}
    for column in input_columns(observation):
        data_type = str(observation.profile.get(f"input.column.{column}.data_type"))
        if not data_type.startswith(TEXT_TYPES):
            continue
        # A column with no values has no share; any other text column must have one.
        if profile_number(observation, f"input.column.{column}.distinct") == 0:
            continue
        share[column] = required_number(observation, f"input.column.{column}.html_share")
    marked = [c for c, s in share.items() if s > 0]
    evidence = [profile_evidence(f"{c} values holding HTML", f"{share[c]:.0%}") for c in marked]
    columns = [c for c in marked if c not in held]
    kept = [c for c in marked if c in held]
    note = (
        f" {', '.join(kept)} also holds HTML, but the target and the unit and time columns are "
        "left as they are."
        if kept
        else ""
    )

    if columns:
        strip = applicable(
            "strip",
            f"{', '.join(columns)}: values hold HTML tags or entities, which would be read as "
            f"words.{note}",
            {"columns": columns},
        )
        keep = applicable(
            "keep", "Keep the markup if it is not HTML: tags and entities stay as words.", {}
        )
        return decision(observation, "strip", [strip, keep], evidence)
    strip = not_applicable("strip", "No feature column holds HTML.")
    keep = applicable("keep", f"No feature column holds HTML.{note}", {})
    return decision(observation, "keep", [strip, keep], evidence)
