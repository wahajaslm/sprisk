"""Every valid fixture must round-trip unchanged; every invalid one must be rejected."""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from sprisk_contracts import (
    Artifact,
    Attempt,
    AttemptOutput,
    ChartReport,
    CodeDisplay,
    CodeInterface,
    CreateRun,
    MethodologyCheck,
    Operator,
    OperatorSource,
    PipelineVersion,
    Problem,
    QuestionVersion,
    Run,
    TablePage,
    WorkerMessage,
)

FIXTURES = Path(__file__).parents[3] / "tests" / "contract"

ENTITIES: list[tuple[type[BaseModel], str]] = [
    (Artifact, "artifact"),
    (Operator, "operator"),
    (PipelineVersion, "pipeline_version"),
    (Run, "run"),
    (Attempt, "attempt"),
    (WorkerMessage, "worker_message"),
    (QuestionVersion, "question_version"),
    (MethodologyCheck, "methodology_check"),
    (CreateRun, "create_run"),
    (AttemptOutput, "attempt_output"),
    (Problem, "problem"),
    (TablePage, "table_page"),
    (CodeDisplay, "code_display"),
    (OperatorSource, "operator_source"),
    (ChartReport, "chart_report"),
    (CodeInterface, "code_interface"),
]


def cases(kind: str) -> list[Any]:
    found = []
    for model, entity in ENTITIES:
        paths = sorted((FIXTURES / entity / kind).glob("*.json"))
        assert paths, f"no fixtures in {FIXTURES / entity / kind}"
        found += [pytest.param(model, p, id=f"{entity}/{p.name}") for p in paths]
    return found


def test_every_fixture_dir_has_an_entity() -> None:
    dirs = {p.name for p in FIXTURES.iterdir() if p.is_dir()}
    assert dirs == {entity for _, entity in ENTITIES}


@pytest.mark.parametrize(("model", "path"), cases("valid"))
def test_valid_fixture_round_trips(model: type[BaseModel], path: Path) -> None:
    text = path.read_text()
    parsed = model.model_validate_json(text)
    assert parsed.model_dump(mode="json") == json.loads(text)


@pytest.mark.parametrize(("model", "path"), cases("invalid"))
def test_invalid_fixture_is_rejected(model: type[BaseModel], path: Path) -> None:
    with pytest.raises(ValidationError):
        model.model_validate_json(path.read_text())
