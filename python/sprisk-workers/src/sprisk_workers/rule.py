"""Run methodology rules' decide() (ADR-0042), one session per review (ADR-0059).

Run as `python -m sprisk_workers.rule`: one RuleRequest per line on stdin, one RuleAnswer per
line on stdout, until stdin closes. Rust picks each module from the loaded rule catalog.
"""

import importlib.util
import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, TextIO

from pydantic import ValidationError

from sprisk_contracts import (
    QuestionVersion,
    RuleAnswer,
    RuleDecision,
    RuleObservation,
    RuleRequest,
)
from sprisk_contracts.generated.models import Fact, RuleDecided, RuleRefused
from sprisk_contracts.generated.models import Profile as ProfileValues
from sprisk_workers.errors import RuleError

Decide = Callable[[RuleObservation], RuleDecision]


def authoritative(fact: Fact | None) -> str | None:
    """A fact's value when it may decide: an inferred fact only asks, never decides."""
    if fact is None or fact.origin.value == "inferred":
        return None
    return fact.value


# The concepts a question's time and entity facts stand for (ADR-0063 amendment).
EVENT_TIME = "common.event_time"
ITEM_IDENTITY = "common.item_identity"


def bound_column(question: QuestionVersion, concept: str, fact: Fact | None) -> str | None:
    """The column the question binds `concept` to, else its fact for it when authoritative. A
    binding a person stated or confirmed takes the place of a fact, as in the walk; one a
    method set unasked does not."""
    for binding in question.bindings or []:
        if binding.concept.root == concept and binding.set_by.root.assurance != "rule":
            return binding.source.column
    return authoritative(fact)


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
    return _columns(observation, "column.")


def input_columns(observation: RuleObservation) -> list[str]:
    """The columns of the rows the step reads, measured before the split (ADR-0059), for a
    rule that reads input.column.*.data_type."""
    return _columns(observation, "input.column.")


def _columns(observation: RuleObservation, prefix: str) -> list[str]:
    suffix = ".data_type"
    names = {
        key[len(prefix) : -len(suffix)]
        for key in observation.profile
        if key.startswith(prefix) and key.endswith(suffix)
    }
    return sorted(names)


def measure(observation: RuleObservation, column: str, name: str) -> float | str | bool | None:
    value = observation.profile.get(f"column.{column}.{name}")
    if isinstance(value, ProfileValues):
        raise RuleError(f"profile gives a list for {name} of column {column}, which is one value")
    return value


def train_rows(observation: RuleObservation) -> int:
    """How many train rows the step's profile measured."""
    rows = observation.profile.get("rows")
    if not isinstance(rows, (int, float)):
        raise RuleError(f"profile gives {rows!r} for rows, which is a count")
    return int(rows)


def profile_number(observation: RuleObservation, name: str) -> float | None:
    """A numeric measure by its full name, such as input.rows or target.distinct; None where
    the profile left it out."""
    value = observation.profile.get(name)
    if value is not None and not isinstance(value, (int, float)):
        raise RuleError(f"profile gives {value!r} for {name}, which is a number")
    return value


def required_number(observation: RuleObservation, name: str) -> float:
    """A numeric measure every observation of the rule has, such as join.rows; its absence is a
    broken observation, not zero."""
    value = profile_number(observation, name)
    if value is None:
        raise RuleError(f"the observation gives no {name}")
    return value


def input_values(observation: RuleObservation, column: str, name: str) -> list[str]:
    """A list of dataset text measured on the rows the step reads, such as the values of a
    column that do not read as numbers; empty where the profile left it out."""
    value = observation.profile.get(f"input.column.{column}.{name}")
    if value is None:
        return []
    if not isinstance(value, ProfileValues):
        raise RuleError(f"profile gives {value!r} for {name} of column {column}, which is a list")
    return [item.root for item in value.root]


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
    "flow.scaled_columns": "Inputs a Scale step before this model covers",
    "step.method": "This step's method",
    "step.task": "This step's task",
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


def run_rule(module_path: Path, observation: RuleObservation) -> RuleDecision:
    # The module is rule-pack code: its output is checked again, like any input.
    decision = RuleDecision.model_validate_json(
        load_decide(module_path)(observation).model_dump_json()
    )
    if decision.rule != observation.rule:
        raise RuleError(
            f"rule {observation.rule.root} returned a decision for {decision.rule.root}"
        )
    return decision


def answer(request: RuleRequest) -> RuleAnswer:
    """The decision, or the rule's own refusal; any other failure is a bug and ends the session."""
    try:
        decision = run_rule(Path(request.module), request.observation)
    except RuleError as e:
        return RuleAnswer(RuleRefused(answer="refused", error=str(e)))
    return RuleAnswer(RuleDecided(answer="decided", decision=decision))


def serve(requests: TextIO, answers: TextIO) -> None:
    """One answer line per request line, until the requests end."""
    for line in requests:
        try:
            request = RuleRequest.model_validate_json(line)
        except ValidationError as e:
            raise RuleError(f"invalid rule request: {e}") from e
        answers.write(answer(request).model_dump_json(exclude_none=True) + "\n")
        answers.flush()


def main() -> None:
    # Answers go to a copy of stdout; stdout itself becomes stderr, so a rule that prints
    # (Python or C) can never write a line Rust takes for an answer.
    answers = os.fdopen(os.dup(sys.stdout.fileno()), "w")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    try:
        serve(sys.stdin, answers)
    except RuleError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
