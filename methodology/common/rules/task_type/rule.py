"""Whether a model step predicts a class or a number (ADR-0059).

Measured from the target's values on the train rows: two values, or text, are classes; many
numeric values are a quantity. A few whole numbers could be classes, grades or counts, so the
person says which. A stated task wins when the values allow it; when they contradict it, the
rule asks. Changing the model step's task is the only effect.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.errors import RuleError
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    flow_evidence,
    needs_fact,
    not_applicable,
    profile_evidence,
    profile_number,
    question_evidence,
)

TASKS = ("classification", "regression")
NUMERIC = ("Int", "UInt", "Float", "Decimal")


def decide(observation: RuleObservation) -> RuleDecision:
    distinct = profile_number(observation, "target.distinct")
    data_type = observation.profile.get("target.data_type")
    if distinct is not None and not isinstance(data_type, str):
        raise RuleError("profile gives target.distinct but no target.data_type")
    evidence = question_evidence(observation, {"question.task": "Task"})
    evidence += flow_evidence(observation, ["step.task"])
    if distinct is not None:
        evidence.append(profile_evidence("Target values on train rows", str(int(distinct))))
    stated = authoritative(observation.facts.get("question.task"))

    if distinct is None:
        why = "The train rows have no target column to measure; check the step's target."
        return decision(observation, "classification", _ask(why), evidence)
    if distinct <= 1:
        why = "The target has one value on the train rows: there is nothing to predict."
        return decision(observation, "classification", _ask(why), evidence)

    measured = _measured(int(distinct), str(data_type), observation.settings["max_classes"])
    if stated in TASKS:
        if measured not in (None, stated):
            why = (
                f"The question says {stated}, but the target has {int(distinct)} values on the "
                f"train rows, which reads as {measured}. Say which is right."
            )
            return decision(observation, stated, _ask(why), evidence)
        return decision(observation, stated, _pick(stated, "The question says so."), evidence)
    if measured is None and not str(data_type).startswith(NUMERIC):
        why = (
            f"The target is text with {int(distinct)} values, too many for classes: an "
            "identifier, free text or numbers stored as text? Check the target."
        )
        return decision(observation, "classification", _ask(why), evidence)
    if measured is None:
        why = (
            f"The target has {int(distinct)} numeric values: classes, ordered grades or "
            "counts? Say which."
        )
        return decision(observation, "classification", _ask(why), evidence)
    why = f"The target has {int(distinct)} values on the train rows."
    return decision(observation, measured, _pick(measured, why), evidence)


def _measured(distinct: int, data_type: str, max_classes: int) -> str | None:
    """The task the target's values show, or None when they leave it open: a few numbers
    (classes, grades or counts) or text with too many values for classes."""
    if distinct == 2:
        return "classification"
    if not data_type.startswith(NUMERIC):
        return "classification" if distinct <= max_classes else None
    if distinct > max_classes:
        return "regression"
    return None


def _pick(task: str, why: str) -> list[dict[str, Any]]:
    other = "regression" if task == "classification" else "classification"
    return [
        applicable(task, why, {"task": task}),
        not_applicable(
            other, f"The model predicts a {'class' if task == 'classification' else 'number'}."
        ),
    ]


def _ask(why: str) -> list[dict[str, Any]]:
    return [needs_fact(task, why) for task in TASKS]
