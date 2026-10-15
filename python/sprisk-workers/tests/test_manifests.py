from pathlib import Path

import pytest

from sprisk_workers.errors import ManifestError
from sprisk_workers.manifests import load_operators
from sprisk_workers.ops.split import temporal_split

PLUGINS = Path(__file__).parents[3] / "plugins"

MANIFEST = """
schema_version: sprisk.operator/v1
id: sprisk.validation.temporal_split@1.0.0
capability_class: transform
entrypoint: {entrypoint}
inputs: [{{ name: data, kind: table }}]
outputs: [{{ name: train, kind: table }}, {{ name: test, kind: table }}]
params_schema: {{ type: object }}
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
        "sprisk.io.file_source@1.0.0",
        "sprisk.ml.dummy_baseline@1.0.0",
        "sprisk.ml.evaluate@1.0.0",
        "sprisk.ml.linear_model@1.0.0",
        "sprisk.profile.summarize@1.0.0",
        "sprisk.validation.random_split@1.0.0",
        "sprisk.validation.temporal_split@1.0.0",
    ]
    split = ops["sprisk.validation.temporal_split@1.0.0"]
    assert split.run is temporal_split
    assert split.output_ports == {"train", "test"}
    assert split.params_schema["required"] == ["time_column", "test_fraction"]


def test_entrypoint_outside_core_ops_is_refused(tmp_path: Path) -> None:
    # Third-party plugin code needs isolation first (arch doc §12).
    write(tmp_path, "os:system")
    with pytest.raises(ManifestError, match="os:system"):
        load_operators(tmp_path)


def test_missing_entrypoint_function_is_an_error(tmp_path: Path) -> None:
    write(tmp_path, "sprisk_workers.ops.split:nope")
    with pytest.raises(ManifestError, match="nope"):
        load_operators(tmp_path)


def test_unimportable_entrypoint_module_is_an_error(tmp_path: Path) -> None:
    write(tmp_path, "sprisk_workers.ops.nope:f")
    with pytest.raises(ManifestError, match="cannot import"):
        load_operators(tmp_path)


def test_invalid_manifest_is_an_error(tmp_path: Path) -> None:
    write(tmp_path, "NOT VALID")
    with pytest.raises(ManifestError, match="manifest.yaml"):
        load_operators(tmp_path)
