from collections.abc import Callable
from typing import Any

import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from sprisk_validation.temporal_split import temporal_split
from sprisk_workers.notebook_code import read_settings, source_cell

CELL = source_cell(temporal_split)
NAMES = ({"data": "rows"}, {"train": "a", "test": "b"})


def test_temporal_split_puts_all_train_strictly_before_test() -> None:
    df = pl.DataFrame({"t": [5, 1, 2, 2, 3, 3, 4, 4, 1, 5]})
    train, test = temporal_split(df, time_column="t", test_fraction=0.3)
    assert train["t"].max() < test["t"].min()  # type: ignore[operator]
    assert train.height + test.height == 10


@pytest.mark.parametrize(
    ("df", "error"),
    [
        (pl.DataFrame({"t": [1, None, 3, 4]}), ValueError),
        (pl.DataFrame({"other": [1, 2]}), pl.exceptions.ColumnNotFoundError),
        (pl.DataFrame({"t": [1, 1, 1, 1]}), ValueError),
    ],
)
def test_temporal_split_rejects_bad_data(df: pl.DataFrame, error: type[Exception]) -> None:
    with pytest.raises(error):
        temporal_split(df, time_column="t", test_fraction=0.5)


def test_a_group_column_keeps_test_entities_out_of_train() -> None:
    df = pl.DataFrame({"t": [1, 2, 3, 4, 5, 6], "user": ["a", "b", "c", "d", "a", "e"]})
    train, test = temporal_split(df, time_column="t", test_fraction=0.34, group_column="user")
    assert test["t"].to_list() == [4, 5, 6]
    # a is in test, so its earlier row leaves train.
    assert train["t"].to_list() == [2, 3]


def test_purging_every_train_row_is_an_error_not_an_empty_train() -> None:
    df = pl.DataFrame({"t": [1, 2, 3, 4], "user": ["a", "a", "a", "a"]})
    with pytest.raises(ValueError, match="train"):
        temporal_split(df, time_column="t", test_fraction=0.5, group_column="user")


@pytest.mark.parametrize("group", [None, "who"])
def test_plain_code_splits_the_rows_as_the_step_does(group: str | None) -> None:
    # Entity 9 is in both: the purge drops its train row.
    who = [9, 9, 2, 3, 4, 5, 6, 7, 1, 8]
    data = pl.DataFrame({"t": [5, 1, 2, 2, 3, 3, 4, 4, 1, 5], "who": who})
    values: dict[str, Any] = {"time_column": "t", "test_fraction": 0.3}
    if group:
        values["group_column"] = group
    namespace: dict[str, Any] = {"rows": data}
    exec(CELL(values, *NAMES), namespace)
    train, test = temporal_split(data, **values)
    assert namespace["a"].equals(train)
    assert namespace["b"].equals(test)


@settings(max_examples=40, deadline=None)
@given(name=st.text(min_size=1))
def test_column_names_never_become_code(code_shape: Callable[[str], str], name: str) -> None:
    def code(column: str) -> str:
        values = {"time_column": column, "test_fraction": 0.3, "group_column": column}
        return CELL(values, *NAMES)

    assert code_shape(code(name)) == code_shape(code("t"))


def test_an_edited_fraction_in_the_code_is_read_back_as_the_setting() -> None:
    values = {"time_column": "t", "test_fraction": 0.3}
    edited = CELL(values, *NAMES).replace("test_fraction=0.3", "test_fraction=0.2")
    assert read_settings(CELL, values, *NAMES, edited) == {**values, "test_fraction": 0.2}
