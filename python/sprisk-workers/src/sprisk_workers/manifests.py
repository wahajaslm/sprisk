import importlib
import json
from pathlib import Path

import yaml
from pydantic import ValidationError

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError
from sprisk_workers.serve import LoadedOperator

# Only first-party packs run until plugin isolation exists (arch doc §12).
TRUSTED_PACKAGES = (
    "sprisk_io",
    "sprisk_profile",
    "sprisk_validation",
    "sprisk_ml",
)


def load_operators(root: Path) -> dict[str, LoadedOperator]:
    """Map each operator ref under `root` to the function its manifest names."""
    return dict(_load(path) for path in sorted(root.rglob("manifest.yaml")))


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
    return operator.id.root, LoadedOperator(
        run=function, output_ports=ports, params_schema=operator.params_schema
    )
