"""Whether the question states its goal and success bar before any run (ADR-0059).

Only a person can say what the work is for and which score is good enough. The bar is the
question's acceptance criteria; a guessed or missing one asks, since a bar set after the scores
always looks met. An exploration predicts nothing, so it needs no bar.
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

# Only a bar a person stated counts: a guessed or measured one would be set from the data.
STATED = ("explicit", "confirmed")
LABELS = {
    "question.objective": "Goal",
    "question.acceptance_criteria": "Success bar",
    "question.task": "Task",
}


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    evidence = question_evidence(observation, LABELS)
    task = facts.get("question.task")
    if task is not None and task.value == "exploration":
        stated = not_applicable("stated", "An exploration predicts nothing to hold to a bar.")
        explore = (
            applicable("exploration", "The question explores the data, so it has no bar.", {})
            if authoritative(task)
            else needs_fact("exploration", "Confirm that the question only explores the data.")
        )
        return decision(observation, "exploration", [stated, explore], evidence)

    goal = facts.get("question.objective")
    bar = facts.get("question.acceptance_criteria")
    missing = []
    if goal is None or goal.origin.value == "inferred":
        missing.append("confirm the goal")
    if bar is None:
        missing.append("state the score that counts as good enough")
    elif bar.origin.value not in STATED:
        missing.append(f"confirm the success bar ({bar.value})")
    explore = not_applicable("exploration", "The question predicts, so it needs a success bar.")
    # goal and bar are checked again only so the type checker knows they are set.
    if missing or goal is None or bar is None:
        ask = needs_fact("stated", f"Before any run, {' and '.join(missing)}.")
        return decision(observation, "stated", [ask, explore], evidence)
    goal_text, bar_text = goal.value.rstrip("."), bar.value.rstrip(".")
    stated = applicable("stated", f"Goal: {goal_text}. Success bar: {bar_text}.", {})
    return decision(observation, "stated", [stated, explore], evidence)
