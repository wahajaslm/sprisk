"""Whether a column is an identifier, to be left out before the split (ADR-0059).

An identifier is a whole-number or one-word text column with a different value in every row:
it names a row and carries no pattern, so a model would memorise rows by it. Measured from
structure on all rows. All-unique decimals are measurements and all-unique multi-word text is
free text. The target, the entity and the time column always stay. On few rows a column
may be unique by chance, so it stays, and leaving it out is offered.
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
    question_evidence,
    required_number,
)

LABELS = {
    "question.target": "Target",
    "question.entity_column": "Entity column",
    "question.time_column": "Time column",
}


def decide(observation: RuleObservation) -> RuleDecision:
    rows = int(required_number(observation, "input.rows"))
    # A copied row repeats its identifier too; the exact-duplicates rule removes it later.
    # Not measured: every row counts.
    distinct_rows = rows - int(profile_number(observation, "input.duplicate_rows") or 0)
    columns = input_columns(observation)
    kept = {f.value for name in LABELS if (f := observation.facts.get(name)) is not None}
    ids = [c for c in columns if c not in kept and _identifier(observation, c, distinct_rows)]
    evidence = question_evidence(observation, LABELS) + [profile_evidence("Rows", str(rows))]
    if not ids:
        why = "No column has a different whole number or one-word code in every row."
        alternatives = [not_applicable("drop_identifiers", why), applicable("keep_all", why, {})]
        return decision(observation, "keep_all", alternatives, evidence)

    evidence.append(profile_evidence("Identifiers", ", ".join(ids)))
    keep = [c for c in columns if c not in ids]
    named = ", ".join(ids)
    leaves_features = bool(set(keep) - kept)
    drop = (
        applicable(
            "drop_identifiers",
            f"{named} hold a different value in every row: they name rows, so leave them out.",
            {"columns": keep},
        )
        if leaves_features
        else needs_fact(
            "drop_identifiers",
            f"Leaving out {named} leaves no column to learn from: say which ones only name rows.",
        )
    )
    if rows < int(observation.settings["min_rows"]):
        why = (
            f"{named} differ in every one of only {rows} rows, which may be chance, so they "
            "stay; leave them out if they only name rows."
        )
        return decision(observation, "keep_all", [drop, applicable("keep_all", why, {})], evidence)
    not_kept = not_applicable("keep_all", "Some columns are identifiers.")
    return decision(observation, "drop_identifiers", [drop, not_kept], evidence)


def _identifier(observation: RuleObservation, column: str, rows: int) -> bool:
    data_type = str(observation.profile.get(f"input.column.{column}.data_type"))
    distinct = int(required_number(observation, f"input.column.{column}.distinct"))
    if distinct < rows or rows == 0:
        return False
    if data_type.startswith(("Int", "UInt")):
        return True
    if data_type != "String":
        return False
    words = required_number(observation, f"input.column.{column}.word_share")
    return words <= float(observation.settings["max_word_share"])
