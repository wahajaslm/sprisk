import polars as pl
import pytest

from sprisk_clean.columns import drop_duplicates, drop_missing, mark_missing, select_columns

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


ROWS = pl.DataFrame({"a": [1, 1, 2, 1], "b": ["x", "x", "y", "z"]})


def test_drop_duplicates_keeps_the_first_of_each_exact_copy_in_order() -> None:
    assert drop_duplicates(ROWS).rows() == [(1, "x"), (2, "y"), (1, "z")]


def test_drop_duplicates_can_compare_only_some_columns() -> None:
    assert drop_duplicates(ROWS, columns=["a"]).rows() == [(1, "x"), (2, "y")]


def test_drop_duplicates_names_a_missing_column() -> None:
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        drop_duplicates(ROWS, columns=["nope"])


def test_mark_missing_turns_the_listed_values_into_gaps_in_the_listed_columns_only() -> None:
    data = pl.DataFrame({"a": ["?", "1", "n/a"], "b": ["?", "?", "ok"]})
    out = mark_missing(data, columns=["a"], values=["?", "n/a"])
    assert out["a"].to_list() == [None, "1", None]
    assert out["b"].to_list() == ["?", "?", "ok"]


def test_mark_missing_matches_whole_values_only() -> None:
    data = pl.DataFrame({"a": ["n/a", "n/a yet", " n/a"]})
    assert mark_missing(data, ["a"], values=["n/a"])["a"].to_list() == [None, "n/a yet", " n/a"]


def test_mark_missing_refuses_a_number_column() -> None:
    with pytest.raises(ValueError, match="b is not text"):
        mark_missing(pl.DataFrame({"b": [1, 2]}), columns=["b"], values=["?"])
