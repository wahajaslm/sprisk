"""Every valid fixture must round-trip unchanged; every invalid one must be rejected."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from sprisk_contracts import Artifact, Operator, PipelineVersion
from sprisk_contracts.base import StrictModel

FIXTURES = Path(__file__).parents[3] / "tests" / "contract"

ENTITIES: list[tuple[type[StrictModel], str]] = [
    (Artifact, "artifact"),
    (Operator, "operator"),
    (PipelineVersion, "pipeline_version"),
]


def cases(kind: str) -> list[tuple[type[StrictModel], Path]]:
    found = []
    for model, entity in ENTITIES:
        paths = sorted((FIXTURES / entity / kind).glob("*.json"))
        assert paths, f"no fixtures in {FIXTURES / entity / kind}"
        found += [(model, p) for p in paths]
    return found


def case_id(case: object) -> str:
    return case.name if isinstance(case, Path) else ""


@pytest.mark.parametrize(("model", "path"), cases("valid"), ids=case_id)
def test_valid_fixture_round_trips(model: type[StrictModel], path: Path) -> None:
    text = path.read_text()
    parsed = model.model_validate_json(text)
    assert parsed.model_dump(mode="json", exclude_unset=True) == json.loads(text)


@pytest.mark.parametrize(("model", "path"), cases("invalid"), ids=case_id)
def test_invalid_fixture_is_rejected(model: type[StrictModel], path: Path) -> None:
    with pytest.raises(ValidationError):
        model.model_validate_json(path.read_text())
