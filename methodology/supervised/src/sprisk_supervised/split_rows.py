"""Do the rows a split produced keep the question's time and entity rules? (ADR-0040 runtime)

The plan check (split_design) reads a split's settings; this reads the rows it wrote, so it
also catches a split step whose code does not do what its settings say.
"""

from typing import Any

import polars as pl

from sprisk_contracts import MethodologyCheck, QuestionVersion
from sprisk_contracts.generated.models import MethodologyCoverage, MethodologyPhase, Verdict
from sprisk_supervised.split_design import CHECK
from sprisk_supervised.split_leakage import CheckInputError
from sprisk_workers.rule import authoritative

LIMITATIONS = "Reads only the train and test rows of this step, not rows a later step adds."


def split_rows(
    train: pl.DataFrame,
    test: pl.DataFrame,
    question: QuestionVersion | None,
    pipeline_version_id: str,
    node_id: str,
    check_id: str,
    now: str,
) -> MethodologyCheck:
    def result(verdict: Verdict, rationale: str) -> MethodologyCheck:
        return _result(pipeline_version_id, node_id, check_id, now, verdict, rationale)

    if question is None:
        return result(
            Verdict.not_assessed,
            f"No question is linked, so step {node_id}'s rows are not checked.",
        )
    if train.is_empty() or test.is_empty():
        raise CheckInputError(
            f"split {node_id} gave {train.height} train and {test.height} test rows; "
            "an empty side cannot be checked"
        )
    time = authoritative(question.time_column)
    entity = authoritative(question.entity_column)
    if not time and not entity:
        facts = (question.time_column, question.entity_column)
        unconfirmed = [f.value for f in facts if f is not None]
        if unconfirmed:
            return result(
                Verdict.not_assessed,
                f"Confirm whether {' and '.join(unconfirmed)} orders or groups the rows "
                f"before step {node_id}'s rows can be checked against it.",
            )
        return result(
            Verdict.not_assessed,
            f"The question has no time or entity column, so step {node_id}'s rows have no "
            "order or grouping to keep.",
        )

    problems, kept = [], []
    if time:
        _require(time, node_id, train, test)
        first_test = test.select(pl.col(time).min()).item()
        late = train.filter(pl.col(time) >= first_test).height
        if late:
            problems.append(
                f"{late} train rows have {time} on or after the first test row's ({first_test!s})"
            )
        else:
            kept.append(f"every train row is earlier than every test row by {time}")
    if entity:
        _require(entity, node_id, train, test)
        both = train.select(entity).unique().join(test.select(entity).unique(), on=entity)
        if both.height:
            example = both[entity].sort().head(3).to_list()
            values = "value is" if both.height == 1 else "values are"
            problems.append(
                f"{both.height} {entity} {values} in both train and test, e.g. {example}"
            )
        else:
            kept.append(f"no {entity} is in both train and test")
    if problems:
        return result(Verdict.fail, f"In step {node_id}'s rows, {'; '.join(problems)}.")
    return result(Verdict.pass_, f"In step {node_id}'s rows, {' and '.join(kept)}.")


def _require(column: str, node_id: str, *tables: pl.DataFrame) -> None:
    if any(column not in t.columns for t in tables):
        raise CheckInputError(f"split {node_id}'s rows have no {column} column to check")
    # Polars skips nulls in min() and joins, so a null would pass unchecked.
    if any(t[column].null_count() for t in tables):
        raise CheckInputError(
            f"split {node_id}'s rows have missing {column} values, which cannot be checked"
        )


def _result(
    pipeline_version_id: str,
    node_id: str,
    check_id: str,
    now: str,
    verdict: Verdict,
    rationale: str,
) -> MethodologyCheck:
    coverage = (
        MethodologyCoverage.not_assessed
        if verdict == Verdict.not_assessed
        else MethodologyCoverage.complete
    )
    raw: dict[str, Any] = {
        "schema_version": "sprisk.methodology_check/v1",
        "id": check_id,
        "pipeline_version_id": pipeline_version_id,
        "check": CHECK,
        "phase": MethodologyPhase.runtime,
        "coverage": coverage,
        "verdict": verdict,
        "rationale": rationale,
        "cited_nodes": [node_id],
        "limitations": LIMITATIONS,
        "created_at": now,
    }
    return MethodologyCheck.model_validate(raw)
