"""Whether rows equal to an earlier row are dropped before the split (ADR-0059).

A row copied into both train and test is scored on a row the model has seen. A row match fits
nothing, so duplicates may be counted and dropped on all rows before the split. Many duplicates
may be real repeated observations, so then the rule asks instead.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.errors import RuleError
from sprisk_workers.rule import (
    applicable,
    decision,
    needs_fact,
    not_applicable,
    profile_evidence,
    profile_number,
)


def decide(observation: RuleObservation) -> RuleDecision:
    measured_rows = profile_number(observation, "input.rows")
    measured_duplicates = profile_number(observation, "input.duplicate_rows")
    if measured_rows is None or measured_duplicates is None:
        raise RuleError("profile has no input.rows or input.duplicate_rows")
    rows, duplicates = int(measured_rows), int(measured_duplicates)
    share = duplicates / rows if rows else 0.0
    limit = observation.settings["ask_above_share"]
    evidence = [
        profile_evidence("Rows before the split", str(rows)),
        profile_evidence("Rows equal to an earlier row", str(duplicates)),
    ]
    if duplicates == 0:
        drop = not_applicable("drop", "No row repeats an earlier one.")
        keep = applicable("keep", "No row repeats an earlier one.", {})
        return decision(observation, "keep", [drop, keep], evidence)
    if share <= limit:
        drop = applicable(
            "drop",
            f"{duplicates} of {rows} rows repeat an earlier row. Dropping them before the split "
            "keeps a copy from landing in both train and test.",
            {},
        )
        keep = not_applicable("keep", "A copy could land in both train and test.")
        return decision(observation, "drop", [drop, keep], evidence)
    why = (
        f"{duplicates} of {rows} rows ({share:.0%}) repeat an earlier row, more than "
        f"{limit:.0%}. They may be real repeated observations; say whether they are copies."
    )
    return decision(
        observation, "keep", [needs_fact("drop", why), needs_fact("keep", why)], evidence
    )
