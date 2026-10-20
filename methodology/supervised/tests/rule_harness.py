"""Run a rule's decide() on a hand-made observation, as the rule runner would."""

import json
from pathlib import Path
from typing import Any

from sprisk_contracts import RuleObservation
from sprisk_workers.rule import load_decide

PACKS = Path(__file__).parents[2]


def decide(
    pack_rule: str,
    *,
    facts: dict[str, tuple[str, str]] | None = None,
    profile: dict[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pack, rule = pack_rule.split("/")
    observation = RuleObservation.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_observation/v1",
                "rule": f"methodology.{pack}.{rule}@1.0.0",
                "facts": {k: {"value": v, "origin": o} for k, (v, o) in (facts or {}).items()},
                "profile": profile or {},
                "settings": settings or {},
            }
        )
    )
    decision = load_decide(PACKS / pack / "rules" / rule / "rule.py")(observation)
    result: dict[str, Any] = json.loads(decision.model_dump_json())
    return result


def alternative(decision: dict[str, Any], id: str) -> dict[str, Any]:
    return next(a for a in decision["alternatives"] if a["id"] == id)


def column(name: str, data_type: str = "Float64", **measures: float) -> dict[str, Any]:
    facts: dict[str, Any] = {f"column.{name}.data_type": data_type}
    facts.update({f"column.{name}.{k}": v for k, v in measures.items()})
    return facts


def flow(
    families: str | None = None,
    fill_gaps: str | None = None,
    standardize: str | None = None,
    hidden: str = "none",
) -> dict[str, tuple[str, str]]:
    """The flow facts Rust sends about the models downstream; None leaves one out."""
    facts = {
        "flow.model_families": families,
        "flow.models_hidden": hidden,
        "flow.models_fill_gaps": fill_gaps,
        "flow.models_standardize": standardize,
    }
    return {k: (v, "measured") for k, v in facts.items() if v is not None}


# What the ml plugin's manifests declare, as Rust reports one model of each.
FOREST = flow("tree_ensemble", "all", "all")
LINEAR = flow("linear", "all", "all")
CLUSTERING = flow("distance_based", "none", "none")
