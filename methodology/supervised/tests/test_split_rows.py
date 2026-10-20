"""The split row check: do the rows a split produced keep the question's time and entity rules?"""

import json
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from sprisk_contracts import MethodologyCheck, QuestionVersion
from sprisk_supervised.split_design import CHECK
from sprisk_supervised.split_leakage import CheckInputError
from sprisk_supervised.split_rows import split_rows

CONTRACT = Path(__file__).parents[3] / "tests" / "contract"
NOW = "2026-10-20T10:00:00Z"
PV = "plv_01JABCDEFGHJKMNPQRSTVWXYZ1"
TIME = {"time_column": {"value": "day", "origin": "confirmed"}}
ENTITY = {"entity_column": {"value": "patient", "origin": "confirmed"}}


def question(**facts: dict[str, str]) -> QuestionVersion:
    raw = json.loads((CONTRACT / "question_version/valid/exploration-no-target.json").read_text())
    return QuestionVersion.model_validate_json(json.dumps({**raw, **facts}))


def rows(days: list[int], patients: list[str]) -> pl.DataFrame:
    return pl.DataFrame({"day": [date(2026, 1, d) for d in days], "patient": patients})


def check(
    train: pl.DataFrame, test: pl.DataFrame, asked: QuestionVersion | None
) -> MethodologyCheck:
    return split_rows(train, test, asked, PV, "split", "mck_01JABCDEFGHJKMNPQRSTVWXYZ0", NOW)


def test_is_the_runtime_half_of_the_split_rule() -> None:
    result = check(rows([1], ["a"]), rows([2], ["b"]), question(**TIME))
    assert result.check.root == CHECK == "methodology.supervised.data_split@1.0.0"
    assert result.phase is not None and result.phase.value == "runtime"
    assert [n.root for n in result.cited_nodes] == ["split"]
    assert result.pipeline_version_id.root == PV


@pytest.mark.parametrize(
    ("train", "test", "facts", "verdict"),
    [
        (rows([1, 2], ["a", "b"]), rows([3, 4], ["c", "d"]), TIME, "pass"),
        (rows([1, 3], ["a", "b"]), rows([3, 4], ["c", "d"]), TIME, "fail"),
        (rows([1, 5], ["a", "b"]), rows([3, 4], ["c", "d"]), TIME, "fail"),
        (rows([1, 2], ["a", "b"]), rows([1, 2], ["c", "d"]), ENTITY, "pass"),
        (rows([1, 2], ["a", "b"]), rows([3, 4], ["b", "c"]), ENTITY, "fail"),
        (rows([1, 2], ["a", "b"]), rows([3, 4], ["b", "c"]), {**TIME, **ENTITY}, "fail"),
        (rows([1, 2], ["a", "b"]), rows([3, 4], ["c", "d"]), {**TIME, **ENTITY}, "pass"),
    ],
)
def test_the_rows_keep_every_confirmed_rule(
    train: pl.DataFrame, test: pl.DataFrame, facts: dict[str, Any], verdict: str
) -> None:
    result = check(train, test, question(**facts))
    assert result.verdict == verdict, result.rationale
    expected = "complete" if verdict != "not_assessed" else "not_assessed"
    assert result.coverage is not None and result.coverage.value == expected


def test_a_late_train_row_is_counted_and_named() -> None:
    result = check(rows([1, 5, 6], ["a", "b", "c"]), rows([3, 4], ["d", "e"]), question(**TIME))
    assert "2 train rows" in result.rationale
    assert "day" in result.rationale


def test_a_shared_entity_is_counted_and_an_example_named() -> None:
    result = check(rows([1, 2], ["a", "b"]), rows([3, 4], ["b", "c"]), question(**ENTITY))
    assert "1 patient" in result.rationale
    assert "b" in result.rationale


def test_without_a_question_the_rows_are_not_assessed() -> None:
    assert check(rows([1], ["a"]), rows([2], ["b"]), None).verdict == "not_assessed"


@pytest.mark.parametrize("fact", ["time_column", "entity_column"])
def test_an_inferred_fact_is_not_checked(fact: str) -> None:
    inferred = {fact: {"value": "day", "origin": "inferred"}}
    result = check(rows([5], ["a"]), rows([1], ["a"]), question(**inferred))
    assert result.verdict == "not_assessed"
    assert "confirm" in result.rationale.lower()


def test_no_time_or_entity_column_leaves_nothing_to_check() -> None:
    result = check(rows([5], ["a"]), rows([1], ["a"]), question())
    assert result.verdict == "not_assessed"


def test_a_confirmed_column_missing_from_the_rows_is_bad_input() -> None:
    with pytest.raises(CheckInputError, match="day"):
        check(rows([1], ["a"]).drop("day"), rows([2], ["b"]), question(**TIME))


def test_an_empty_side_is_bad_input() -> None:
    with pytest.raises(CheckInputError, match="empty"):
        check(rows([1], ["a"]).clear(), rows([2], ["b"]), question(**TIME))


@pytest.mark.parametrize("side", ["train", "test"])
@pytest.mark.parametrize(("facts", "column"), [(TIME, "day"), (ENTITY, "patient")])
def test_a_missing_value_in_a_confirmed_column_is_bad_input(
    facts: dict[str, Any], column: str, side: str
) -> None:
    tables = {"train": rows([1], ["a"]), "test": rows([2], ["b"])}
    tables[side] = tables[side].with_columns(pl.lit(None).alias(column))
    with pytest.raises(CheckInputError, match=column):
        check(tables["train"], tables["test"], question(**facts))
