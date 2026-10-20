import json
from datetime import UTC, datetime
from typing import Any

import polars as pl
from pydantic import ValidationError
from ulid import ULID

from sprisk_contracts import MethodologyDecision, Operator, PipelineVersion, QuestionVersion
from sprisk_supervised.code_leakage import code_leakage
from sprisk_supervised.split_design import split_design
from sprisk_supervised.split_leakage import CheckInputError, split_leakage
from sprisk_supervised.split_rows import split_rows
from sprisk_workers.errors import OperatorError


def run(
    pipeline: Any, operators: list[Any], question: Any, decisions: list[Any]
) -> list[dict[str, Any]]:
    """Gate B for the Supervised pack: every rule's result, as one JSON array (ADR-0017).

    `question` is the question the pipeline answers, or None when it is not linked;
    `decisions` are the methodology decisions its nodes cite.
    """
    try:
        version = PipelineVersion.model_validate_json(json.dumps(pipeline))
        known = [Operator.model_validate_json(json.dumps(o)) for o in operators]
        asked = (
            None if question is None else QuestionVersion.model_validate_json(json.dumps(question))
        )
        chosen = [MethodologyDecision.model_validate_json(json.dumps(d)) for d in decisions]
    except ValidationError as e:
        raise OperatorError("invalid_check_input", str(e)) from e
    linked = version.question_version_id
    sent = None if asked is None else asked.id
    if linked != sent:
        raise OperatorError(
            "invalid_check_input",
            f"pipeline {version.id.root} answers question "
            f"{linked.root if linked else 'none'}, but the gate was sent "
            f"{sent.root if sent else 'none'}",
        )
    by_ref = {op.id.root: op for op in known}
    now = _now()
    try:
        results = [
            split_leakage(version, by_ref, f"mck_{ULID()}", now),
            code_leakage(version, f"mck_{ULID()}", now),
            *split_design(version, asked, chosen, lambda: f"mck_{ULID()}", now),
        ]
    except CheckInputError as e:
        raise OperatorError("invalid_check_input", str(e)) from e
    if linked is not None:
        results = [r.model_copy(update={"question_version_id": linked}) for r in results]
    return [r.model_dump(mode="json", exclude_none=True) for r in results]


def split_rows_run(
    train: pl.DataFrame,
    test: pl.DataFrame,
    question: Any,
    pipeline_version_id: str,
    node_id: str,
) -> list[dict[str, Any]]:
    """The runtime check after split step `node_id`, as a one-item JSON array (ADR-0040)."""
    try:
        asked = (
            None if question is None else QuestionVersion.model_validate_json(json.dumps(question))
        )
        check = split_rows(
            train, test, asked, pipeline_version_id, node_id, f"mck_{ULID()}", _now()
        )
    except (ValidationError, CheckInputError) as e:
        raise OperatorError("invalid_check_input", str(e)) from e
    if asked is not None:
        check = check.model_copy(update={"question_version_id": asked.id})
    return [check.model_dump(mode="json", exclude_none=True)]


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
