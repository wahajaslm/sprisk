"""Which split keeps test rows unseen the way production will see them (ADR-0042).

Only confirmed, explicit or measured facts decide. An inferred column makes its option
ask for confirmation instead of guessing.
"""

import json
from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_contracts.generated.models import Fact

LABELS = {
    "question.target": "Target",
    "question.task": "Task",
    "question.time_column": "Time column",
    "question.entity_column": "Entity column",
}


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    settings = observation.settings
    fraction = settings["default_test_fraction"]
    seed = settings["default_seed"]
    time = _authoritative(facts.get("question.time_column"))
    entity = _authoritative(facts.get("question.entity_column"))
    target = _authoritative(facts.get("question.target"))
    task = _authoritative(facts.get("question.task"))

    temporal = (
        _applicable(
            "temporal",
            "A confirmed time column sets the prediction chronology: train on earlier rows.",
            {"time_column": time, "test_fraction": fraction},
        )
        if time
        else _needs("temporal", "Confirm the time column before it can order the split.")
    )
    entity_group = (
        _applicable(
            "entity_group",
            "A confirmed entity key keeps each entity wholly in train or in test.",
            {"group_column": entity, "test_fraction": fraction, "seed": seed},
        )
        if entity
        else _needs("entity_group", "Confirm the entity column before it can group the split.")
    )
    if task == "classification" and target:
        stratified = _applicable(
            "stratified_random",
            "Keeps each class's share the same in train and test.",
            {"stratify": target, "test_fraction": fraction, "seed": seed},
        )
    else:
        stratified = _not_applicable(
            "stratified_random", "Stratifying needs a confirmed classification target."
        )
    simple = _applicable(
        "simple_random",
        "Shuffles rows with a fixed seed. It ignores any time or entity boundary.",
        {"test_fraction": fraction, "seed": seed},
    )

    if time:
        recommended = "temporal"
    elif entity:
        recommended = "entity_group"
    elif stratified["applicability"] == "applicable":
        recommended = "stratified_random"
    else:
        recommended = "simple_random"

    evidence = [
        {"kind": "question_fact", "label": label, "value": f.value, "origin": f.origin.value}
        for name, label in LABELS.items()
        if (f := facts.get(name)) is not None
    ]
    return RuleDecision.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_decision/v1",
                "rule": observation.rule.root,
                "recommended_alternative_id": recommended,
                "alternatives": [temporal, entity_group, stratified, simple],
                "evidence": evidence,
            }
        )
    )


def _authoritative(fact: Fact | None) -> str | None:
    if fact is None or fact.origin.value == "inferred":
        return None
    return fact.value


def _applicable(id: str, reason: str, params: dict[str, Any]) -> dict[str, Any]:
    return {"id": id, "applicability": "applicable", "reason": reason, "params": params}


def _needs(id: str, reason: str) -> dict[str, Any]:
    return {"id": id, "applicability": "needs_fact", "reason": reason}


def _not_applicable(id: str, reason: str) -> dict[str, Any]:
    return {"id": id, "applicability": "not_applicable", "reason": reason}
