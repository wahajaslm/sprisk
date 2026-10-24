"""The operators the repo's plugins declare, as the gate is sent them."""

import json
from pathlib import Path

import yaml

from sprisk_contracts import Operator

PLUGINS = Path(__file__).parents[3] / "plugins"


def repo_operators() -> dict[str, Operator]:
    found = (
        Operator.model_validate_json(json.dumps(yaml.safe_load(path.read_text())))
        for path in PLUGINS.rglob("manifest.yaml")
    )
    return {op.id.root: op for op in found}
