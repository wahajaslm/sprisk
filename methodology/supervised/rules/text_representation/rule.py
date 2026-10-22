"""Which text columns reaching a model are free text, turned into words (ADR-0058).

Free text has many values, most of them several words: product titles, descriptions. One-hot
would make a column per row, and grouping rare values would leave almost nothing. A step added
before the model learns its words and their TF-IDF weights from the train rows, and the model
reads them beside the table. A text column with few values, or one-word codes, is a category:
rare categories and encoding take it.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    measure,
    not_applicable,
    profile_evidence,
    required,
    step_columns,
)

TEXT_TYPES = ("String", "Utf8")


def decide(observation: RuleObservation) -> RuleDecision:
    limit = observation.settings["high_cardinality_threshold"]
    least = observation.settings["free_text_word_share"]
    texts = [
        c
        for c in step_columns(observation)
        if str(measure(observation, c, "data_type")).startswith(TEXT_TYPES)
    ]
    distinct = {c: int(required(observation, c, "distinct")) for c in texts}
    empty = [c for c in texts if distinct[c] == 0]
    many = [c for c in texts if distinct[c] > limit]
    # Words are measured wherever a text column has values; one-hot's limit decides the rest.
    share = {c: float(required(observation, c, "word_share")) for c in many}
    free = [c for c in many if share[c] >= least]
    categories = [c for c in texts if c not in free and c not in empty]

    if free:
        words = applicable(
            "vectorize_words",
            f"{', '.join(free)}: more than {limit} values, most of several words, so free "
            "text. Its words and their weights are learnt from the train rows.",
            {"columns": free},
        )
        none = not_applicable("no_free_text", f"{', '.join(free)} holds free text.")
    else:
        parts = []
        if categories:
            parts.append(
                f"{', '.join(categories)}: few values or one-word codes, so categories, not "
                "free text."
            )
        if empty:
            parts.append(f"{', '.join(empty)} has no values in the train rows.")
        reason = " ".join(parts) or "No text column reaches the model."
        words = not_applicable("vectorize_words", reason)
        none = applicable("no_free_text", reason, {})

    evidence = [
        profile_evidence(f"{c} values holding several words", f"{share[c]:.0%}") for c in many
    ]
    evidence += [profile_evidence(f"{c} values", str(distinct[c])) for c in texts]
    alternatives: list[dict[str, Any]] = [
        words,
        none,
        not_applicable("tfidf_chars", "No step for it yet: Vectorize text takes whole words."),
        not_applicable("local_embeddings", "No local embedding step yet."),
    ]
    return decision(
        observation, "vectorize_words" if free else "no_free_text", alternatives, evidence
    )
