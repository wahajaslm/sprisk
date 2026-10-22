import importlib
import inspect
import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError
from sprisk_workers.plain import CheckedFunction, adapt
from sprisk_workers.serve import LoadedOperator

# Only first-party packs run until plugin isolation exists (arch doc §12).
TRUSTED_PACKAGES = (
    "sprisk_io",
    "sprisk_code",
    "sprisk_profile",
    "sprisk_validation",
    "sprisk_ml",
    "sprisk_clean",
    "sprisk_supervised",
)


def load_operators(*roots: Path) -> dict[str, LoadedOperator]:
    """Map each operator ref under `roots` to the function its manifest names."""
    manifests: dict[str, tuple[Path, Operator]] = {}
    for path in sorted(p for root in roots for p in root.rglob("manifest.yaml")):
        operator = _read(path)
        ref = operator.id.root
        if ref in manifests:
            raise ManifestError(f"{path}: operator {ref} is declared twice")
        manifests[ref] = (path, operator)
    # A step comparing models builds them from their manifests (ADR-0046).
    models = {
        ref: _estimator(path, operator.model.estimator.root, operator)
        for ref, (path, operator) in manifests.items()
        if operator.model is not None and operator.model.estimator is not None
    }
    # ...and refits the preparation steps between the split and the model per fold (ADR-0050).
    preparations = {
        ref: CheckedFunction(
            load_function(path, "entrypoint", operator.entrypoint.root), operator.params_schema
        )
        for ref, (path, operator) in manifests.items()
        if operator.fits_on_train
    }
    return {
        ref: _loaded(path, operator, models, preparations)
        for ref, (path, operator) in manifests.items()
    }


def _read(path: Path) -> Operator:
    try:
        return Operator.model_validate_json(json.dumps(yaml.safe_load(path.read_text())))
    except (yaml.YAMLError, ValidationError) as e:
        raise ManifestError(f"{path}: {e}") from e


def load_function(path: Path, what: str, entrypoint: str) -> Callable[..., Any]:
    module_name, function_name = entrypoint.split(":")
    if module_name.split(".")[0] not in TRUSTED_PACKAGES:
        raise ManifestError(f"{path}: {what} {entrypoint} is not in a trusted core pack")
    try:
        module = importlib.import_module(module_name)
    except ImportError as e:
        raise ManifestError(f"{path}: cannot import {module_name}: {e}") from e
    function = getattr(module, function_name, None)
    if function is None:
        raise ManifestError(f"{path}: {module_name} has no function {function_name}")
    return function  # type: ignore[no-any-return]


def _estimator(path: Path, entrypoint: str, operator: Operator) -> CheckedFunction:
    """The model's unfitted-estimator function. It takes every setting of the model except
    the columns it reads (ADR-0046) and its costs, which whoever fits it applies (ADR-0053)."""
    build = load_function(path, "estimator", entrypoint)
    properties: Mapping[str, Any] = operator.params_schema.get("properties") or {}
    expected = sorted(set(properties) - {"target", "features", "costs"})
    takes = sorted(inspect.signature(build).parameters)
    if takes != expected:
        raise ManifestError(f"{path}: estimator takes {takes}; it must take {expected}")
    return CheckedFunction(build, operator.params_schema)


def _loaded(
    path: Path,
    operator: Operator,
    models: Mapping[str, CheckedFunction],
    preparations: Mapping[str, CheckedFunction],
) -> LoadedOperator:
    function = load_function(path, "entrypoint", operator.entrypoint.root)
    # A step's plain code (ADR-0055) is written on request; a typo fails here, at load.
    if operator.notebook_code is not None:
        load_function(path, "notebook_code", operator.notebook_code.root)
    ports = frozenset(port.name.root for port in operator.outputs)
    return LoadedOperator(
        run=adapt(function, operator, models=models, preparations=preparations),
        output_ports=ports,
        params_schema=operator.params_schema,
        operator=operator,
    )
