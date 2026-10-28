"""Meanings the packs ask for. A project binds each one to a real column; column names never
appear in a pack (ADR-0063)."""

from typing import Annotated, Literal

from sprisk import Concept

ItemIdentity = Annotated[
    str,
    Concept(
        "common.item_identity",
        "entity_identifier",
        "Groups rows that describe the same real-world item.",
    ),
]
EventTime = Annotated[
    str, Concept("common.event_time", "time", "When the event a row describes happened.")
]
Target = Annotated[str, Concept("common.target", "label", "The value the model learns to predict.")]
Task = Literal["classification", "regression"]
