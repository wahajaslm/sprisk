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
    "question.prediction_horizon": "Prediction horizon",
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
    horizon = authoritative(facts.get("question.prediction_horizon"))

    temporal_params = {"time_column": time, "test_fraction": fraction}
    temporal_reason = (
        "A confirmed time column sets the prediction chronology: train on earlier rows."
    )
    if entity:
        # Time alone would let one entity sit on both sides; purge test entities from train.
        temporal_params["group_column"] = entity
        temporal_reason += f" Train drops every {entity} that also appears in test."
    if horizon:
        temporal_reason += (
            f" Labels look {horizon} ahead, and the split leaves no gap at the cutoff yet:"
            " the last train rows may share label windows with test."
        )

    temporal = (
        applicable("temporal", temporal_reason, temporal_params)
        if time
        else needs_fact("temporal", "Confirm the time column before it can order the split.")
    )
    # A confirmed time column requires a temporal split and a confirmed entity column a group
    # split (rule.yaml conditions); Gate B fails any other split, so it is never offered.
    if time:
        entity_group = not_applicable(
            "entity_group", "The confirmed time column requires a temporal split."
        )
    elif entity:
        entity_group = applicable(
            "entity_group",
            "A confirmed entity key keeps each entity wholly in train or in test.",
            {"group_column": entity, "test_fraction": fraction, "seed": seed},
        )
    else:
        entity_group = needs_fact(
            "entity_group", "Confirm the entity column before it can group the split."
        )
    boundary = (
        "The confirmed time column requires a temporal split."
        if time
        else "The confirmed entity column requires a group split."
    )
    if time or entity:
        stratified = not_applicable("stratified_random", boundary)
    elif task == "classification" and target:
        stratified = applicable(
            "stratified_random",
            "Keeps each class's share the same in train and test.",
            {"stratify": target, "test_fraction": fraction, "seed": seed},
        )
    else:
        stratified = not_applicable(
            "stratified_random", "Stratifying needs a confirmed classification target."
        )
    simple = (
        not_applicable("simple_random", boundary)
        if time or entity
        else applicable(
            "simple_random",
            "Shuffles rows with a fixed seed. It ignores any time or entity boundary.",
            {"test_fraction": fraction, "seed": seed},
        )
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
