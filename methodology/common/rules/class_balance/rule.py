"""Whether a classification target is unbalanced (ADR-0059).

Its rarest class is compared with the share every class would have if the classes were even:
a rarest class far under that makes accuracy reward always saying the common classes. Measured
on the train rows of a model step that predicts a class. Unequal error costs are not imbalance:
they move the decision threshold (Elkan 2001), which the cost rules handle. The rule records the
finding; the split, metric and imbalance rules act on it.
"""

from collections.abc import Callable
from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    flow_evidence,
    needs_fact,
    not_applicable,
    profile_evidence,
    profile_number,
)


def decide(observation: RuleObservation) -> RuleDecision:
    evidence = flow_evidence(observation, ["step.task"])
    step_task = observation.facts.get("step.task")
    if step_task is None or step_task.value != "classification":
        why = "The model step does not predict a class, so there are no classes to balance."
        return decision(observation, "balanced", _both(not_applicable, why), evidence)

    rarest = profile_number(observation, "target.rarest_share")
    classes = profile_number(observation, "target.distinct")
    if rarest is None or classes is None:
        why = (
            "The target has too many classes, or no target on the train rows, to measure its "
            "rarest class."
        )
        return decision(observation, "balanced", _both(needs_fact, why), evidence)
    evidence.append(profile_evidence("Rarest class share of train rows", f"{rarest:.1%}"))
    evidence.append(profile_evidence("Classes", str(int(classes))))
    even = 1 / classes
    bar = observation.settings["min_share_of_even"] * even
    if rarest < bar:
        why = (
            f"The rarest class holds {rarest:.1%} of train rows, under {bar:.1%}: a fifth of "
            f"the {even:.1%} each of {int(classes)} even classes would hold."
        )
        return decision(observation, "unbalanced", _pick("unbalanced", why), evidence)
    why = f"The rarest class holds {rarest:.1%} of train rows, at least {bar:.1%}."
    return decision(observation, "balanced", _pick("balanced", why), evidence)


def _pick(chosen: str, why: str) -> list[dict[str, Any]]:
    other = "balanced" if chosen == "unbalanced" else "unbalanced"
    return [applicable(chosen, why, {}), not_applicable(other, why)]


def _both(make: Callable[[str, str], dict[str, Any]], why: str) -> list[dict[str, Any]]:
    return [make("balanced", why), make("unbalanced", why)]
