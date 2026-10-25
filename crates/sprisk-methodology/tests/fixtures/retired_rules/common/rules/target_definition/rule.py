"""Which column holds the outcome, or that there is none (ADR-0059).

Only a person knows what the outcome is. A named, confirmed column is used; a guessed one asks.
An exploration needs no target. Building a label from a rule is not offered yet, since no step
builds one and checks it against a sample a person labels; sprisk never makes up a target.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    needs_fact,
    not_applicable,
    question_evidence,
)

LABELS = {"question.target": "Target", "question.task": "Task"}


def decide(observation: RuleObservation) -> RuleDecision:
    evidence = question_evidence(observation, LABELS)
    target = observation.facts.get("question.target")
    task = observation.facts.get("question.task")
    derived = not_applicable(
        "derived",
        "No step builds a label from a rule yet; name the column that holds the outcome.",
    )
    if target is not None:
        column = (
            applicable("column", f"{target.value} holds the outcome.", {})
            if authoritative(target)
            else needs_fact("column", f"Confirm that {target.value} holds the outcome.")
        )
        none = not_applicable("no_target", f"The question names {target.value} as its target.")
        return decision(observation, "column", [column, none, derived], evidence)
    if task is not None and task.value == "exploration":
        none = (
            applicable("no_target", "The question explores the data; nothing is predicted.", {})
            if authoritative(task)
            else needs_fact("no_target", "Confirm that the question only explores the data.")
        )
        column = not_applicable("column", "An exploration has no outcome to predict.")
        return decision(observation, "no_target", [column, none, derived], evidence)
    ask = "Name the column that holds the outcome, or make the question an exploration."
    return decision(
        observation,
        "column",
        [needs_fact("column", ask), needs_fact("no_target", ask), derived],
        evidence,
    )
