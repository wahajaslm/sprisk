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
  properties:
    time_column: {{ type: string }}
    test_fraction: {{ type: number }}
    group_column: {{ type: string }}
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
        "sprisk.clean.audit_audio@1.0.0",
        "sprisk.clean.audit_images@1.0.0",
        "sprisk.clean.cast_types@1.0.0",
        "sprisk.clean.clean_text@1.0.0",
        "sprisk.clean.clip_outliers@1.0.0",
        "sprisk.clean.date_parts@1.0.0",
        "sprisk.clean.drop_columns@1.0.0",
        "sprisk.clean.drop_duplicates@1.0.0",
        "sprisk.clean.drop_missing@1.0.0",
        "sprisk.clean.embed_images@1.0.0",
        "sprisk.clean.encode@1.0.0",
        "sprisk.clean.featurize_audio@1.0.0",
        "sprisk.clean.group_rare@1.0.0",
        "sprisk.clean.impute@1.0.0",
        "sprisk.clean.leave_out@1.0.0",
        "sprisk.clean.mark_missing@1.0.0",
        "sprisk.clean.opensmile_audio@1.0.0",
        "sprisk.clean.power_transform@1.0.0",
        "sprisk.clean.scale@1.0.0",
        "sprisk.clean.select_columns@1.0.0",
        "sprisk.clean.spectral_gating@1.0.0",
        "sprisk.clean.strip_html@1.0.0",
        "sprisk.clean.vectorize_text@1.1.0",
        "sprisk.clean.voice_activity@1.0.0",
        "sprisk.clustering.dbscan@1.0.0",
        "sprisk.clustering.gmm@1.0.0",
        "sprisk.clustering.kmeans@1.0.0",
        "sprisk.code.python@1.0.0",
        "sprisk.code.python@1.1.0",
        "sprisk.code.python@1.2.0",
        "sprisk.code.python@2.0.0",
        "sprisk.io.file_source@1.0.0",
        "sprisk.io.join@1.0.0",
        "sprisk.ml.cross_validate@4.0.0",
        "sprisk.ml.dummy_baseline@3.0.0",
        "sprisk.ml.evaluate@2.1.0",
        "sprisk.ml.feature_importance@2.0.0",
        "sprisk.ml.linear_model@3.0.0",
        "sprisk.ml.random_forest@3.0.0",
        "sprisk.ml.select_model@5.0.0",
        "sprisk.profile.chart@1.0.0",
        "sprisk.profile.column_roles@1.0.0",
        "sprisk.profile.distributions@1.0.0",
        "sprisk.profile.html_text@1.0.0",
        "sprisk.profile.identity_frequency@1.0.0",
        "sprisk.profile.join_keys@1.0.0",
        "sprisk.profile.model_inputs@1.0.0",
        "sprisk.profile.near_duplicates@1.0.0",
        "sprisk.profile.number_text@1.0.0",
        "sprisk.profile.spelling_variants@1.0.0",
        "sprisk.profile.summarize@1.0.0",
        "sprisk.profile.target_shape@1.0.0",
        "sprisk.validation.class_shares@2.0.0",
        "sprisk.validation.group_overlap@1.0.0",
        "sprisk.validation.group_split@1.0.0",
        "sprisk.validation.random_split@1.0.0",
        "sprisk.validation.row_overlap@1.0.0",
        "sprisk.validation.temporal_split@1.0.0",
        "sprisk.validation.time_order@1.0.0",
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


def test_a_missing_plain_code_writer_is_an_error(tmp_path: Path) -> None:
    write(
        tmp_path,
        "sprisk_validation.temporal_split:temporal_split\n"
        "notebook_code: sprisk_validation.temporal_split:nope",
    )
    with pytest.raises(ManifestError, match="notebook_code|nope"):
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


MODEL = """
schema_version: sprisk.operator/v1
id: sprisk.ml.linear_model@3.0.0
capability_class: estimator
model: {{ family: linear, tasks: [classification], estimator: "{estimator}" }}
entrypoint: sprisk_ml.models:linear_model
inputs: [{{ name: train, kind: table }}, {{ name: words, kind: matrix, optional: true }}]
outputs: [{{ name: model, kind: model }}]
params_schema:
  type: object
  properties:
    target: {{ type: string }}
    features: {{ type: array }}
    exclude: {{ type: array }}
    task: {{ type: string }}
    costs: {{ type: object }}
effects: pure
network: none
resources: {{ cpu_cores: 1, memory_mb: 512, gpu: none, timeout_seconds: 60 }}
"""


def write_model(root: Path, estimator: str) -> None:
    path = root / "pack" / "operators" / "model" / "manifest.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(MODEL.format(estimator=estimator))


def test_a_models_estimator_must_take_its_settings_but_target_features_and_costs(
    tmp_path: Path,
) -> None:
    # random_forest_estimator also takes n_estimators and seed, which this manifest lacks.
    write_model(tmp_path, "sprisk_ml.models:random_forest_estimator")
    with pytest.raises(ManifestError, match=r"must take \['task'\]"):
        load_operators(tmp_path)


def test_an_estimator_outside_core_packs_is_refused(tmp_path: Path) -> None:
    write_model(tmp_path, "os:system")
    with pytest.raises(ManifestError, match="estimator os:system is not in a trusted core pack"):
        load_operators(tmp_path)


def test_a_models_estimator_loads_beside_its_entrypoint(tmp_path: Path) -> None:
    write_model(tmp_path, "sprisk_ml.models:linear_model_estimator")
    assert list(load_operators(tmp_path)) == ["sprisk.ml.linear_model@3.0.0"]


# The code step runs the user's code; its own module is the worker's runner for it (ADR-0022).
RUNNERS = {"sprisk_code"}  # methodology packs live outside plugins/ and are runners too


def test_no_step_imports_sprisk() -> None:
    """Steps are plain Polars / scikit-learn code (ADR-0022); the worker does the plumbing."""
    sources = [p for p in PLUGINS.glob("*/src/*/*.py") if p.parent.name not in RUNNERS]
    assert sources
    for path in sources:
        text = path.read_text()
        assert "from sprisk" not in text and "import sprisk" not in text, path
