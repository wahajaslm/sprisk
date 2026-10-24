"""Whether the question states its goal and success bar before any run (ADR-0059).

Only a person can say what the work is for and which score is good enough. The bar is the
question's success bar, or else its acceptance criteria; a guessed or missing one asks, since a
bar set after the scores always looks met. An exploration predicts nothing, so it needs no bar.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_contracts.generated.models import Fact
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
    "question.success_bar.metric": "Success bar metric",
    "question.success_bar.score": "Success bar score",
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
    bar = stated_bar(observation) or facts.get("question.acceptance_criteria")
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


# Lower is better for a cost or an error (ADR-0059).
LOWER_IS_BETTER = ("expected_cost", "rmse")


def stated_bar(observation: RuleObservation) -> Fact | None:
    """The success bar as one fact, when the question states one; only a person can."""
    metric = observation.facts.get("question.success_bar.metric")
    score = observation.facts.get("question.success_bar.score")
    if metric is None or score is None:
        return None
    side = "at most" if metric.value in LOWER_IS_BETTER else "at least"
    return Fact(value=f"{metric.value} of {side} {score.value}", origin=metric.origin)
