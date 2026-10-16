import polars as pl
import pytest

from sprisk_clean.columns import drop_missing, select_columns

DATA = pl.DataFrame({"a": [1, None, 3], "b": ["x", "y", None], "c": [1.0, 2.0, 3.0]})


def test_select_keeps_only_the_named_columns_in_that_order() -> None:
    assert select_columns(DATA, columns=["c", "a"]).columns == ["c", "a"]


def test_select_names_a_missing_column() -> None:
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        select_columns(DATA, columns=["nope"])


def test_drop_missing_drops_rows_with_a_gap_in_the_named_columns_only() -> None:
    assert drop_missing(DATA, columns=["a"])["a"].to_list() == [1, 3]
    assert drop_missing(DATA, columns=["a", "b"]).height == 1


def test_drop_missing_treats_nan_as_missing() -> None:
    assert drop_missing(pl.DataFrame({"x": [1.0, float("nan")]}), columns=["x"]).height == 1
