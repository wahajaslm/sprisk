"""Which text columns reaching a model get their rare categories grouped (ADR-0057).

A text column with more categories than one-hot encoding takes has rare ones a model learns
little from. A step added before the model makes each category under a share of the train
rows "other", and keeps at most as many categories as one-hot takes, counting "other", as
scikit-learn's OneHotEncoder(min_frequency, max_categories) does. The encoding rule can then
take the column. A column with its own value for most rows is an identifier: grouping would
leave one value, so it is named and left alone.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    measure,
    needs_fact,
    not_applicable,
    profile_evidence,
    required,
    step_columns,
)

TEXT_TYPES = ("String", "Utf8", "Categorical", "Enum")


def decide(observation: RuleObservation) -> RuleDecision:
    limit = observation.settings["high_cardinality_threshold"]
    rows = int(observation.profile["rows"])
    texts = [
        c
        for c in step_columns(observation)
        if str(measure(observation, c, "data_type")).startswith(TEXT_TYPES)
    ]
    distinct = {c: int(required(observation, c, "distinct")) for c in texts}
    over = [c for c in texts if distinct[c] > limit]
    identifiers = [
        c for c in over if distinct[c] >= observation.settings["identifier_share"] * rows
    ]
    many = [c for c in over if c not in identifiers]
    named = (
        f" Left alone: {', '.join(identifiers)}, its own value for most train rows, so an "
        "identifier."
        if identifiers
        else ""
    )
    nothing = f"No text column other than an identifier has more than {limit} categories.{named}"

    if many:
        group = applicable(
            "group_rare",
            f"{', '.join(f'{c} ({distinct[c]} categories)' for c in many)}: more than {limit}, "
            f'too many for one-hot. Rare ones become "other", keeping at most {limit}, counted '
            "on the train rows." + named,
            {
                "columns": many,
                "min_share": observation.settings["min_share"],
                "max_categories": limit,
            },
        )
        keep = not_applicable(
            "keep_categories", f"{', '.join(many)}: too many categories for one-hot."
        )
    elif identifiers:
        group = not_applicable("group_rare", nothing)
        keep = needs_fact(
            "keep_categories",
            f"{', '.join(identifiers)} has its own value for most train rows, so it looks like "
            "an identifier, which lets a model memorise rows. Confirm it is not a feature and "
            "drop it.",
        )
    else:
        group = not_applicable("group_rare", nothing)
        keep = applicable("keep_categories", nothing, {})

    evidence = [profile_evidence(f"{c} categories", str(distinct[c])) for c in texts]
    evidence.append(profile_evidence("Train rows", str(rows)))
    alternatives: list[dict[str, Any]] = [group, keep]
    return decision(
        observation, "group_rare" if many else "keep_categories", alternatives, evidence
    )
