from pathlib import Path

import pytest

from sprisk_workers.errors import ManifestError
from sprisk_workers.manifests import load_operators

PLUGINS = Path(__file__).parents[3] / "plugins"

MANIFEST = """
schema_version: sprisk.operator/v1
id: sprisk.validation.temporal_split@1.0.0
capability_class: transform
entrypoint: {entrypoint}
inputs: [{{ name: data, kind: table }}]
outputs: [{{ name: train, kind: table }}, {{ name: test, kind: table }}]
params_schema:
  type: object
  properties: {{ time_column: {{ type: string }}, test_fraction: {{ type: number }} }}
effects: pure
network: none
resources: {{ cpu_cores: 1, memory_mb: 512, gpu: none, timeout_seconds: 60 }}
"""


def write(root: Path, entrypoint: str) -> None:
    path = root / "pack" / "operators" / "op" / "manifest.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(MANIFEST.format(entrypoint=entrypoint))


def test_every_core_manifest_loads_with_its_entrypoint() -> None:
    ops = load_operators(PLUGINS)
    assert sorted(ops) == [
        "sprisk.clean.clean_text@1.0.0",
        "sprisk.clean.clip_outliers@1.0.0",
        "sprisk.clean.impute@1.0.0",
        "sprisk.clean.scale@1.0.0",
        "sprisk.code.python@1.0.0",
        "sprisk.code.python@1.1.0",
        "sprisk.code.python@1.2.0",
        "sprisk.io.file_source@1.0.0",
        "sprisk.ml.dummy_baseline@1.0.0",
        "sprisk.ml.evaluate@1.0.0",
        "sprisk.ml.linear_model@1.0.0",
        "sprisk.profile.distributions@1.0.0",
        "sprisk.profile.summarize@1.0.0",
        "sprisk.validation.random_split@1.0.0",
        "sprisk.validation.temporal_split@1.0.0",
    ]
    split = ops["sprisk.validation.temporal_split@1.0.0"]
    assert split.output_ports == {"train", "test"}
    assert split.params_schema["required"] == ["time_column", "test_fraction"]


def test_entrypoint_outside_core_ops_is_refused(tmp_path: Path) -> None:
    # Third-party plugin code needs isolation first (arch doc §12).
    write(tmp_path, "os:system")
    with pytest.raises(ManifestError, match="os:system"):
        load_operators(tmp_path)


def test_missing_entrypoint_function_is_an_error(tmp_path: Path) -> None:
    write(tmp_path, "sprisk_validation.temporal_split:nope")
    with pytest.raises(ManifestError, match="nope"):
        load_operators(tmp_path)


def test_unimportable_entrypoint_module_is_an_error(tmp_path: Path) -> None:
    write(tmp_path, "sprisk_ml.nope:f")
    with pytest.raises(ManifestError, match="cannot import"):
        load_operators(tmp_path)


def test_invalid_manifest_is_an_error(tmp_path: Path) -> None:
    write(tmp_path, "NOT VALID")
    with pytest.raises(ManifestError, match="manifest.yaml"):
        load_operators(tmp_path)


def test_same_operator_in_two_roots_is_an_error(tmp_path: Path) -> None:
    write(tmp_path / "a", "sprisk_validation.temporal_split:temporal_split")
    write(tmp_path / "b", "sprisk_validation.temporal_split:temporal_split")
    with pytest.raises(ManifestError, match="declared twice"):
        load_operators(tmp_path / "a", tmp_path / "b")


# The code step runs the user's code; its own module is the worker's runner for it (ADR-0022).
RUNNERS = {"sprisk_code"}  # methodology packs live outside plugins/ and are runners too


def test_no_step_imports_sprisk() -> None:
    """Steps are plain Polars / scikit-learn code (ADR-0022); the worker does the plumbing."""
    sources = [p for p in PLUGINS.glob("*/src/*/*.py") if p.parent.name not in RUNNERS]
    assert sources
    for path in sources:
        text = path.read_text()
        assert "from sprisk" not in text and "import sprisk" not in text, path
