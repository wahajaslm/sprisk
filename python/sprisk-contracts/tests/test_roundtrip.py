"""Every valid fixture must round-trip unchanged; every invalid one must be rejected."""

import json
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from sprisk_contracts import Artifact, Attempt, Operator, PipelineVersion, Run, WorkerMessage

FIXTURES = Path(__file__).parents[3] / "tests" / "contract"

ENTITIES: list[tuple[type[BaseModel], str]] = [
    (Artifact, "artifact"),
    (Operator, "operator"),
    (PipelineVersion, "pipeline_version"),
    (Run, "run"),
    (Attempt, "attempt"),
    (WorkerMessage, "worker_message"),
]


def cases(kind: str) -> list[tuple[type[BaseModel], Path]]:
    found = []
    for model, entity in ENTITIES:
        paths = sorted((FIXTURES / entity / kind).glob("*.json"))
        assert paths, f"no fixtures in {FIXTURES / entity / kind}"
        found += [(model, p) for p in paths]
    return found


def case_id(case: object) -> str:
    return case.name if isinstance(case, Path) else ""


@pytest.mark.parametrize(("model", "path"), cases("valid"), ids=case_id)
def test_valid_fixture_round_trips(model: type[BaseModel], path: Path) -> None:
    text = path.read_text()
    parsed = model.model_validate_json(text)
    assert parsed.model_dump(mode="json", exclude_unset=True) == json.loads(text)


@pytest.mark.parametrize(("model", "path"), cases("invalid"), ids=case_id)
def test_invalid_fixture_is_rejected(model: type[BaseModel], path: Path) -> None:
    with pytest.raises(ValidationError):
        model.model_validate_json(path.read_text())
