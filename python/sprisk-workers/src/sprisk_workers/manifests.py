import importlib
import inspect
import json
from pathlib import Path

import yaml
from pydantic import ValidationError

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError
from sprisk_workers.plain import adapt
from sprisk_workers.serve import LoadedOperator, OperatorFn

# Steps not yet converted to plain functions (ADR-0022) still take these three arguments.
STAGED_ARGUMENTS = ["params", "inputs", "out_dir"]

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
    loaded: dict[str, LoadedOperator] = {}
    for path in sorted(p for root in roots for p in root.rglob("manifest.yaml")):
        ref, operator = _load(path)
        if ref in loaded:
            raise ManifestError(f"{path}: operator {ref} is declared twice")
        loaded[ref] = operator
    return loaded


def _load(path: Path) -> tuple[str, LoadedOperator]:
    try:
        operator = Operator.model_validate_json(json.dumps(yaml.safe_load(path.read_text())))
    except (yaml.YAMLError, ValidationError) as e:
        raise ManifestError(f"{path}: {e}") from e
    entrypoint = operator.entrypoint
    module_name, function_name = entrypoint.split(":")
    if module_name.split(".")[0] not in TRUSTED_PACKAGES:
        raise ManifestError(f"{path}: entrypoint {entrypoint} is not in a trusted core pack")
    try:
        module = importlib.import_module(module_name)
    except ImportError as e:
        raise ManifestError(f"{path}: cannot import {module_name}: {e}") from e
    function = getattr(module, function_name, None)
    if function is None:
        raise ManifestError(f"{path}: {module_name} has no function {function_name}")
    ports = frozenset(port.name.root for port in operator.outputs)
    staged = list(inspect.signature(function).parameters) == STAGED_ARGUMENTS
    run: OperatorFn = function if staged else adapt(function, operator)
    return operator.id.root, LoadedOperator(
        run=run, output_ports=ports, params_schema=operator.params_schema
    )
