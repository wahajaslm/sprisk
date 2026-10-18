import json
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from ulid import ULID

from sprisk_contracts import Operator, PipelineVersion
from sprisk_supervised.code_leakage import code_leakage
from sprisk_supervised.split_leakage import CheckInputError, split_leakage
from sprisk_workers.errors import OperatorError


def run(pipeline: Any, operators: list[Any]) -> list[dict[str, Any]]:
    """Gate B for the Supervised pack: every rule's result, as one JSON array (ADR-0017)."""
    try:
        version = PipelineVersion.model_validate_json(json.dumps(pipeline))
        known = [Operator.model_validate_json(json.dumps(o)) for o in operators]
    except ValidationError as e:
        raise OperatorError("invalid_check_input", str(e)) from e
    by_ref = {op.id.root: op for op in known}
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        results = [
            split_leakage(version, by_ref, f"mck_{ULID()}", now),
            code_leakage(version, f"mck_{ULID()}", now),
        ]
    except CheckInputError as e:
        raise OperatorError("invalid_check_input", str(e)) from e
    return [r.model_dump(mode="json", exclude_none=True) for r in results]
