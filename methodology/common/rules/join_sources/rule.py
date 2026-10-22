"""Whether a loaded table no step reads is joined to the rows the split reads (ADR-0059).

With one such table, the join goes on the one column both share, when every row finds exactly
one row of the other table. A row with no match would join with gaps, such as a missing label,
and a repeated key would copy rows and change the unit of prediction. Several tables, several
shared columns, a partial match or a question over time ask, since which rows belong together,
and whether the other table was known at prediction time, are facts about the business.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    needs_fact,
    not_applicable,
    profile_evidence,
    question_evidence,
    required_number,
)

PREFIX, MATCHED, MOST = "join.key.", ".matched_rows", ".most_rows_per_key"
UNREAD = "A loaded table is read by no step."


def decide(observation: RuleObservation) -> RuleDecision:
    unread = int(required_number(observation, "join.unread_tables"))
    evidence = question_evidence(observation, {"question.time_column": "Time column"})
    evidence.append(profile_evidence("Loaded tables no step reads", str(unread)))
    if unread == 0:
        why = "Every loaded table is read by a step, so there is nothing to join."
        alternatives = [applicable("single_source", why, {}), not_applicable("join_on_key", why)]
        return decision(observation, "single_source", alternatives, evidence)
    if unread > 1:
        why = f"{unread} loaded tables are read by no step: say which to join, on which column."
        return _ask(observation, why, evidence)

    rows = int(required_number(observation, "join.rows"))
    keys = _keys(observation)
    evidence += [
        profile_evidence(
            f"Rows finding a match on {c}", f"{matched} of {rows}; at most {most} per value"
        )
        for c, (matched, most) in keys.items()
    ]
    if not keys:
        why = "The tables share no column: say which columns say which rows belong together."
        return _ask(observation, why, evidence)
    if len(keys) > 1:
        why = f"Both tables have {', '.join(keys)}: say which is the key; the others would clash."
        return _ask(observation, why, evidence)
    [(key, (matched, most))] = keys.items()
    if most > 1:
        why = (
            f"One value of {key} finds {most} rows of the other table, so joining would copy rows."
        )
        return _ask(observation, why, evidence)
    if matched < rows:
        why = (
            f"{rows - matched} of {rows} rows find no match on {key}, so they would join with "
            "gaps, such as a missing label. Say whether the key or the files are wrong."
        )
        return _ask(observation, why, evidence)
    if observation.facts.get("question.time_column") is not None:
        why = (
            f"Every row finds one match on {key}, but the question is over time: confirm the "
            "other table holds only what was known at prediction time."
        )
        return _ask(observation, why, evidence)
    why = f"Every one of the {rows} rows finds exactly one row of the other table on {key}."
    alternatives = [
        not_applicable("single_source", UNREAD),
        applicable("join_on_key", why, {"key": key}),
    ]
    return decision(observation, "join_on_key", alternatives, evidence)


def _keys(observation: RuleObservation) -> dict[str, tuple[int, int]]:
    """Each shared column's matched rows and most rows per value."""
    columns = sorted(
        n[len(PREFIX) : -len(MATCHED)]
        for n in observation.profile
        if n.startswith(PREFIX) and n.endswith(MATCHED)
    )
    return {
        c: (
            int(required_number(observation, f"{PREFIX}{c}{MATCHED}")),
            int(required_number(observation, f"{PREFIX}{c}{MOST}")),
        )
        for c in columns
    }


def _ask(observation: RuleObservation, why: str, evidence: list[dict[str, Any]]) -> RuleDecision:
    alternatives = [not_applicable("single_source", UNREAD), needs_fact("join_on_key", why)]
    return decision(observation, "join_on_key", alternatives, evidence)
