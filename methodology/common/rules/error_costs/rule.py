"""Whether a two-class question states what each error costs (ADR-0053, ADR-0059).

Only a person knows what a miss and a false alarm cost. Stated costs are recorded; equal costs
count only when the person states them; missing or guessed costs ask, since the decision
threshold reads them. Follows the model step's task; other tasks, and targets with more than
two classes, are not applicable yet.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    flow_evidence,
    needs_fact,
    not_applicable,
    profile_number,
    question_evidence,
)

LABELS = {
    "question.costs.positive": "Costly class",
    "question.costs.false_negative": "Cost of a miss",
    "question.costs.false_positive": "Cost of a false alarm",
}


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    evidence = question_evidence(observation, LABELS) + flow_evidence(observation, ["step.task"])
    step_task = facts.get("step.task")
    if step_task is None or step_task.value != "classification":
        why = "The model step does not predict a class, so its errors have no costs to state."
        return decision(observation, "stated", _neither(why), evidence)
    classes = profile_number(observation, "target.distinct")
    if classes is not None and classes > 2:
        why = f"Costs are stated for two classes; this target has {int(classes)}."
        return decision(observation, "stated", _neither(why), evidence)

    miss = authoritative(facts.get("question.costs.false_negative"))
    alarm = authoritative(facts.get("question.costs.false_positive"))
    if miss is None or alarm is None:
        why = "State, or confirm, what missing the costly class costs and what a false alarm costs."
        asked = [needs_fact("stated", why), needs_fact("equal", why)]
        return decision(observation, "stated", asked, evidence)
    if float(miss) == float(alarm):
        why = f"A miss and a false alarm both cost {float(miss):g}."
        chosen = [applicable("equal", why, {}), not_applicable("stated", why)]
        return decision(observation, "equal", chosen, evidence)
    why = f"A miss costs {float(miss):g} and a false alarm {float(alarm):g}."
    chosen = [applicable("stated", why, {}), not_applicable("equal", why)]
    return decision(observation, "stated", chosen, evidence)


def _neither(why: str) -> list[dict[str, Any]]:
    return [not_applicable("stated", why), not_applicable("equal", why)]
