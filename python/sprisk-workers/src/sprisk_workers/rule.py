"""Run one methodology rule's decide() (ADR-0042).

Run as `python -m sprisk_workers.rule <path/to/rule.py>` with a RuleObservation on stdin;
prints the RuleDecision. Rust picks the module from the loaded rule catalog.
"""

import importlib.util
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_contracts.generated.models import Fact
from sprisk_workers.errors import RuleError

Decide = Callable[[RuleObservation], RuleDecision]


def authoritative(fact: Fact | None) -> str | None:
    """A fact's value when it may decide: an inferred fact only asks, never decides."""
    if fact is None or fact.origin.value == "inferred":
        return None
    return fact.value


def applicable(id: str, reason: str, params: dict[str, Any]) -> dict[str, Any]:
    return {"id": id, "applicability": "applicable", "reason": reason, "params": params}


def needs_fact(id: str, reason: str) -> dict[str, Any]:
    return {"id": id, "applicability": "needs_fact", "reason": reason}


def not_applicable(id: str, reason: str) -> dict[str, Any]:
    return {"id": id, "applicability": "not_applicable", "reason": reason}


def decision(
    observation: RuleObservation,
    recommended: str,
    alternatives: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
) -> RuleDecision:
    return RuleDecision.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_decision/v1",
                "rule": observation.rule.root,
                "recommended_alternative_id": recommended,
                "alternatives": alternatives,
                "evidence": evidence,
            }
        )
    )


def shortlist_decision(
    observation: RuleObservation,
    shortlist: list[str],
    alternatives: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
) -> RuleDecision:
    """A shortlist rule's decision: the alternatives worth comparing, and no single pick."""
    return RuleDecision.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_decision/v1",
                "rule": observation.rule.root,
                "shortlist": shortlist,
                "alternatives": alternatives,
                "evidence": evidence,
            }
        )
    )


def question_evidence(observation: RuleObservation, labels: dict[str, str]) -> list[dict[str, Any]]:
    """The question facts a rule read, as evidence, in `labels` order."""
    return [
        {"kind": "question_fact", "label": label, "value": f.value, "origin": f.origin.value}
        for name, label in labels.items()
        if (f := observation.facts.get(name)) is not None
    ]


def step_columns(observation: RuleObservation) -> list[str]:
    """The step's columns: every profiled column has a data type, so a rule that reads
    column.*.data_type sees them all, text and constant ones too. One that does not sees none."""
    suffix = ".data_type"
    names = {
        key[len("column.") : -len(suffix)]
        for key in observation.profile
        if key.startswith("column.") and key.endswith(suffix)
    }
    return sorted(names)


def measure(observation: RuleObservation, column: str, name: str) -> float | str | bool | None:
    return observation.profile.get(f"column.{column}.{name}")


def measured(observation: RuleObservation, column: str, name: str) -> float | None:
    """A numeric measure, or None where the profile left it out (no variation, not finite)."""
    value = measure(observation, column, name)
    return None if value is None else float(value)


def required(observation: RuleObservation, column: str, name: str) -> float:
    """A measure every profiled column has; its absence is a broken observation, not zero."""
    value = measured(observation, column, name)
    if value is None:
        raise RuleError(f"profile has no {name} for column {column}")
    return value


def is_numeric(observation: RuleObservation, column: str) -> bool:
    data_type = str(measure(observation, column, "data_type"))
    return data_type.startswith(("Int", "UInt", "Float", "Decimal"))


def profile_evidence(label: str, value: str) -> dict[str, Any]:
    return {"kind": "profile_fact", "label": label, "value": value, "origin": "measured"}


FLOW_LABELS = {
    "flow.model_families": "Model families downstream",
    "flow.models_hidden": "Models downstream behind a step the rules cannot see",
    "flow.other_readers": "Other steps reading this step's output",
    "step.method": "This step's method",
}


def flow_fact(observation: RuleObservation, name: str) -> str | None:
    """A fact Rust read from the models downstream of the step; None when no model is."""
    fact = observation.facts.get(name)
    return None if fact is None else fact.value


def ask_readers(observation: RuleObservation, alternative: dict[str, Any]) -> dict[str, Any]:
    """An applicable alternative that removes the step, made to ask first while an analysis or
    code step reads the step's output: removing it changes what that step sees."""
    readers = flow_fact(observation, "flow.other_readers")
    if readers is None or alternative["applicability"] != "applicable":
        return alternative
    return needs_fact(
        alternative["id"],
        f"{alternative['reason']} Confirm first: {readers} also reads this step's output, and "
        "removing the step changes what it sees.",
    )


def model_families(observation: RuleObservation) -> set[str]:
    """The families of the models Rust can see downstream; empty when it sees none."""
    value = flow_fact(observation, "flow.model_families")
    return set() if value is None else set(value.split(", "))


def flow_evidence(observation: RuleObservation, names: list[str]) -> list[dict[str, Any]]:
    """The flow facts a rule read, as evidence, in `names` order."""
    return [
        {
            "kind": "flow_fact",
            "label": FLOW_LABELS[name],
            "value": f.value,
            "origin": f.origin.value,
        }
        for name in names
        if (f := observation.facts.get(name)) is not None
    ]


def load_decide(module_path: Path) -> Decide:
    spec = importlib.util.spec_from_file_location("sprisk_rule", module_path)
    if spec is None or spec.loader is None:
        raise RuleError(f"cannot load rule module {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    decide = getattr(module, "decide", None)
    if not callable(decide):
        raise RuleError(f"{module_path} has no decide(observation) function")
    return decide  # type: ignore[no-any-return]


def run_rule(module_path: Path, observation_json: str) -> str:
    try:
        observation = RuleObservation.model_validate_json(observation_json)
    except ValidationError as e:
        raise RuleError(f"invalid rule observation: {e}") from e
    # The module is rule-pack code: its output is checked again, like any input.
    decision = RuleDecision.model_validate_json(
        load_decide(module_path)(observation).model_dump_json()
    )
    if decision.rule != observation.rule:
        raise RuleError(
            f"rule {observation.rule.root} returned a decision for {decision.rule.root}"
        )
    return decision.model_dump_json(exclude_none=True)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m sprisk_workers.rule <path/to/rule.py>")
    try:
        sys.stdout.write(run_rule(Path(sys.argv[1]), sys.stdin.read()))
    except RuleError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
