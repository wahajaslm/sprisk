"""Every valid fixture must round-trip unchanged; every invalid one must be rejected."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from sprisk_contracts import Artifact

FIXTURES = Path(__file__).parents[3] / "tests" / "contract" / "artifact"


def fixtures(kind: str) -> list[Path]:
    paths = sorted((FIXTURES / kind).glob("*.json"))
    assert paths, f"no fixtures in {FIXTURES / kind}"
    return paths


@pytest.mark.parametrize("path", fixtures("valid"), ids=lambda p: p.name)
def test_valid_artifact_round_trips(path: Path) -> None:
    original = json.loads(path.read_text())
    artifact = Artifact.model_validate(original)
    assert artifact.model_dump(mode="json", exclude_unset=True) == original


@pytest.mark.parametrize("path", fixtures("invalid"), ids=lambda p: p.name)
def test_invalid_artifact_is_rejected(path: Path) -> None:
    with pytest.raises(ValidationError):
        Artifact.model_validate(json.loads(path.read_text()))
