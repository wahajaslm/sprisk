"""At which threshold a classifier predicts its costed class (ADR-0053).

Stated misclassification costs make each model tune its threshold for the least expected cost;
without them, both mistakes count the same and 0.5 stands. Costs are only ever stated by a
person, so no inferred fact can set them.
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

LABELS = {
    "question.task": "Task",
    "question.time_column": "Time column",
    "question.entity_column": "Entity column",
    "question.costs.positive": "Costed class",
    "question.costs.false_negative": "Cost of a missed costed row",
    "question.costs.false_positive": "Cost of a false alarm",
}


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    task = authoritative(facts.get("question.task"))
    positive = authoritative(facts.get("question.costs.positive"))
    missed = authoritative(facts.get("question.costs.false_negative"))
    alarm = authoritative(facts.get("question.costs.false_positive"))
    ordered = authoritative(facts.get("question.time_column")) or authoritative(
        facts.get("question.entity_column")
    )
    evidence = question_evidence(observation, LABELS)

    standard = applicable(
        "default_half",
        "Predicts the more likely class, as if both mistakes cost the same.",
        {},
    )
    if task is None:
        confirm = needs_fact(
            "cost_optimal_threshold",
            "Confirm the task: only a classification question has a decision threshold.",
        )
        return decision(observation, "default_half", [confirm, standard], evidence)
    if task != "classification":
        reason = f"A {task} question has no classes to predict, so no decision threshold."
        return decision(
            observation,
            "default_half",
            [
                not_applicable("cost_optimal_threshold", reason),
                not_applicable("default_half", reason),
            ],
            evidence,
        )

    if positive is None or missed is None or alarm is None:
        costed = needs_fact(
            "cost_optimal_threshold",
            "State the misclassification costs in the question: which class is costly to "
            "miss, and what each mistake costs.",
        )
        return decision(observation, "default_half", [costed, standard], evidence)
    if ordered:
        costed = not_applicable(
            "cost_optimal_threshold",
            "The threshold is tuned on shuffled inner folds, which do not yet keep time order "
            "or whole entities.",
        )
        return decision(observation, "default_half", [costed, standard], evidence)
    costs = {"positive": positive, "false_negative": float(missed), "false_positive": float(alarm)}
    costed = applicable(
        "cost_optimal_threshold",
        f"Missing a {positive} row costs {float(missed):g} and a false alarm "
        f"{float(alarm):g}, so each model predicts {positive} at the threshold that costs "
        "least on its training rows.",
        {"costs": costs},
    )
    return decision(observation, "cost_optimal_threshold", [costed, standard], evidence)
