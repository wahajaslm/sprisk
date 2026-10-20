"""Which split keeps test rows unseen the way production will see them (ADR-0042).

Only confirmed, explicit or measured facts decide. An inferred column makes its option
ask for confirmation instead of guessing.
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
    time = authoritative(facts.get("question.time_column"))
    entity = authoritative(facts.get("question.entity_column"))
    target = authoritative(facts.get("question.target"))
    task = authoritative(facts.get("question.task"))

    temporal = (
        applicable(
            "temporal",
            "A confirmed time column sets the prediction chronology: train on earlier rows.",
            {"time_column": time, "test_fraction": fraction},
        )
        if time
        else needs_fact("temporal", "Confirm the time column before it can order the split.")
    )
    entity_group = (
        applicable(
            "entity_group",
            "A confirmed entity key keeps each entity wholly in train or in test.",
            {"group_column": entity, "test_fraction": fraction, "seed": seed},
        )
        if entity
        else needs_fact("entity_group", "Confirm the entity column before it can group the split.")
    )
    if task == "classification" and target:
        stratified = applicable(
            "stratified_random",
            "Keeps each class's share the same in train and test.",
            {"stratify": target, "test_fraction": fraction, "seed": seed},
        )
    else:
        stratified = not_applicable(
            "stratified_random", "Stratifying needs a confirmed classification target."
        )
    simple = applicable(
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

    return decision(
        observation,
        recommended,
        [temporal, entity_group, stratified, simple],
        question_evidence(observation, LABELS),
    )
