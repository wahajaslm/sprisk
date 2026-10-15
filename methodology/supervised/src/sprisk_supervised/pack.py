import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from ulid import ULID

from sprisk_contracts import Operator, PipelineVersion
from sprisk_supervised.split_leakage import CheckInputError, split_leakage
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import JSON, Output


def run(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
    """Gate B for the Supervised pack: every rule's result, as one JSON array (ADR-0017)."""
    try:
        pipeline = PipelineVersion.model_validate_json(inputs["pipeline"].read_text())
        operators = [
            Operator.model_validate_json(json.dumps(o))
            for o in json.loads(inputs["operators"].read_text())
        ]
    except (ValidationError, json.JSONDecodeError) as e:
        raise OperatorError("invalid_check_input", str(e)) from e
    by_ref = {op.id.root: op for op in operators}
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        results = [split_leakage(pipeline, by_ref, f"mck_{ULID()}", now)]
    except CheckInputError as e:
        raise OperatorError("invalid_check_input", str(e)) from e
    path = out_dir / "checks.json"
    path.write_text(json.dumps([r.model_dump(mode="json", exclude_none=True) for r in results]))
    return [Output(port="checks", path=path, media_type=JSON)]
