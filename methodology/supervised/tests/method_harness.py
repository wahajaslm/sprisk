"""Run a method's decide() on a hand-made request, as the method runner would: the method
sees only what its method.yaml needs, and reading anything else is refused."""

import json
from pathlib import Path
from typing import Any

import yaml

from sprisk_contracts import MethodRequest
from sprisk_workers.method import answer

PACKS = Path(__file__).parents[2]


def decide(
    pack_method: str,
    *,
    task: str = "classification",
    evidence: dict[str, Any] | None = None,
    decisions: dict[str, str] | None = None,
    bound: list[str] | None = None,
) -> dict[str, Any]:
    """The method's answer: outcome, option and reason, or its refusal."""
    pack, method = pack_method.split("/")
    folder = PACKS / pack / "methods" / method
    manifest = yaml.safe_load((folder / "method.yaml").read_text())
    request = MethodRequest.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.method_request/v1",
                "module": str(folder / "method.py"),
                "method": manifest["id"],
                "needs": manifest["needs"],
                "options": [o["id"] for o in manifest["options"]],
                "task": task,
                "evidence": evidence or {},
                "decisions": decisions or {},
                "bound": bound or [],
            }
        )
    )
    answered: dict[str, Any] = json.loads(answer(request).model_dump_json(exclude_none=True))
    return answered
