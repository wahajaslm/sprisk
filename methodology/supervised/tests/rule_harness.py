"""Run a rule's decide() on a hand-made observation, as the rule runner would: the rule sees
only the facts its manifest reads, as Rust sends them, and reading any other fails."""

import json
from pathlib import Path
from typing import Any

import yaml

from sprisk_contracts import RuleObservation
from sprisk_workers.rule import load_decide

PACKS = Path(__file__).parents[2]
# Origins Rust gives a fact, by where it comes from; an example may give its own.
DEFAULT_ORIGIN = {
    "question": "confirmed",
    "flow": "measured",
    "step": "explicit",
    "candidate": "measured",
}


def manifest(pack_rule: str) -> dict[str, Any]:
    pack, rule = pack_rule.split("/")
    loaded: dict[str, Any] = yaml.safe_load(
        (PACKS / pack / "rules" / rule / "rule.yaml").read_text()
    )
    return loaded


def covers(pattern: str, name: str) -> bool:
    """Whether a `reads` entry covers a fact name; `*` stands for one column or setting name.
    The same match Rust uses to filter what it sends (sprisk_methodology::facts::covers)."""
    prefix, star, suffix = pattern.partition("*")
    if not star:
        return pattern == name
    return (
        len(name) > len(prefix) + len(suffix) and name.startswith(prefix) and name.endswith(suffix)
    )


class Declared(dict[str, Any]):
    """A rule's facts or profile in a test. Reading a name its manifest does not read fails,
    so a rule cannot pass its tests on a fact Rust never sends it (ADR-0045)."""

    def __init__(self, values: dict[str, Any], reads: list[str], rule: str) -> None:
        super().__init__({k: v for k, v in values.items() if any(covers(r, k) for r in reads)})
        self.reads = reads
        self.rule = rule

    def _check(self, name: object) -> None:
        if not any(covers(r, str(name)) for r in self.reads):
            raise AssertionError(f"{self.rule} reads {name}, which its manifest does not declare")

    def get(self, name: str, default: Any = None) -> Any:
        self._check(name)
        return super().get(name, default)

    def __getitem__(self, name: str) -> Any:
        self._check(name)
        return super().__getitem__(name)

    def __contains__(self, name: object) -> bool:
        self._check(name)
        return super().__contains__(name)


def decide(
    pack_rule: str,
    *,
    facts: dict[str, tuple[str, str]] | None = None,
    profile: dict[str, Any] | None = None,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Settings default to the manifest's thresholds."""
    pack, rule = pack_rule.split("/")
    spec = manifest(pack_rule)
    observation = RuleObservation.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_observation/v1",
                "rule": spec["id"],
                "facts": {k: {"value": v, "origin": o} for k, (v, o) in (facts or {}).items()},
                "profile": profile or {},
                "settings": spec["policy_thresholds"] if settings is None else settings,
            }
        )
    )
    reads = spec.get("reads", [])
    observation.facts = Declared(observation.facts, reads, spec["id"])
    observation.profile = Declared(observation.profile, reads, spec["id"])
    decision = load_decide(PACKS / pack / "rules" / rule / "rule.py")(observation)
    result: dict[str, Any] = json.loads(decision.model_dump_json())
    return result


def run_example(pack_rule: str, example: dict[str, Any]) -> dict[str, Any]:
    """A manifest example's decision: `given` split into facts and profile as Rust sends them."""
    facts: dict[str, tuple[str, str]] = {}
    profile: dict[str, Any] = {}
    for name, value in example["given"].items():
        if name == "rows" or name.startswith(("column.", "input.", "target.", "cv.")):
            profile[name] = value
        elif isinstance(value, dict):
            facts[name] = (value["value"], value["origin"])
        else:
            facts[name] = (str(value), DEFAULT_ORIGIN[name.split(".")[0]])
    return decide(pack_rule, facts=facts, profile=profile)


def alternative(decision: dict[str, Any], id: str) -> dict[str, Any]:
    return next(a for a in decision["alternatives"] if a["id"] == id)


def column(name: str, data_type: str = "Float64", **measures: float) -> dict[str, Any]:
    facts: dict[str, Any] = {f"column.{name}.data_type": data_type}
    facts.update({f"column.{name}.{k}": v for k, v in measures.items()})
    return facts


def flow(families: str | None = None, hidden: str = "none") -> dict[str, tuple[str, str]]:
    """The flow facts Rust sends about the models downstream; None leaves one out."""
    facts = {"flow.model_families": families, "flow.models_hidden": hidden}
    return {k: (v, "measured") for k, v in facts.items() if v is not None}


# What the ml plugin's manifests declare, as Rust reports one model of each.
FOREST = flow("tree_ensemble")
LINEAR = flow("linear")
CLUSTERING = flow("distance_based")


def readers(*steps: str) -> dict[str, tuple[str, str]]:
    """Other steps that read the step's output, as Rust reports them."""
    return {"flow.other_readers": (", ".join(sorted(steps)), "measured")}


def step(**settings: str) -> dict[str, tuple[str, str]]:
    """The step's own text settings, as Rust reports them."""
    return {f"step.{k}": (v, "explicit") for k, v in settings.items()}
