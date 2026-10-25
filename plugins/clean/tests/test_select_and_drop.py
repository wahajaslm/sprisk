import polars as pl
import pytest

from sprisk_clean.columns import (
    cast_types,
    drop_columns,
    drop_duplicates,
    drop_missing,
    leave_out,
    mark_missing,
    select_columns,
)

DATA = pl.DataFrame({"a": [1, None, 3], "b": ["x", "y", None], "c": [1.0, 2.0, 3.0]})


def test_select_keeps_only_the_named_columns_in_that_order() -> None:
    assert select_columns(DATA, columns=["c", "a"]).columns == ["c", "a"]


def test_select_names_a_missing_column() -> None:
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        select_columns(DATA, columns=["nope"])


def test_drop_columns_leaves_every_other_column_in_its_order() -> None:
    assert drop_columns(DATA, columns=["b"]).columns == ["a", "c"]


def test_drop_columns_names_a_missing_column() -> None:
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        drop_columns(DATA, columns=["nope"])


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


def test_cast_types_reads_text_columns_as_numbers_and_keeps_gaps() -> None:
    data = pl.DataFrame({"a": [" 1", None, "2.5 "], "b": ["x", "y", "z"]})
    out = cast_types(data, columns=["a"])
    assert out.schema["a"] == pl.Float64 and out["a"].to_list() == [1.0, None, 2.5]
    assert out["b"].to_list() == ["x", "y", "z"]


def test_cast_types_reads_whole_numbers_as_integers() -> None:
    out = cast_types(pl.DataFrame({"n": ["1", "-20", None]}), columns=["n"])
    assert out.schema["n"] == pl.Int64 and out["n"].to_list() == [1, -20, None]


def test_cast_types_refuses_digits_a_float_cannot_hold() -> None:
    with pytest.raises(ValueError, match=r"acct: '1234567890123456' has more than 15 digits"):
        cast_types(pl.DataFrame({"acct": ["1", "1234567890123456"]}), columns=["acct"])


def test_cast_types_names_the_column_and_a_value_that_is_not_a_number() -> None:
    with pytest.raises(ValueError, match=r"a: 'NaN' does not read as a number"):
        cast_types(pl.DataFrame({"a": ["1", "NaN"]}), columns=["a"])


def test_cast_types_refuses_a_column_that_is_not_text() -> None:
    with pytest.raises(ValueError, match="b is not text"):
        cast_types(pl.DataFrame({"b": [1, 2]}), columns=["b"])


def test_cast_types_reads_a_column_name_as_a_name_not_a_pattern() -> None:
    data = pl.DataFrame({"^.*$": ["1"], "other": ["x"]})
    out = cast_types(data, columns=["^.*$"])
    assert out.schema["^.*$"] == pl.Int64 and out.schema["other"] == pl.String


def test_leave_out_drops_the_columns_from_train_and_test_alike() -> None:
    train = pl.DataFrame({"sku": ["a"], "x": [1]})
    test = pl.DataFrame({"sku": ["b"], "x": [2]})
    out = leave_out(train, test, ["sku"])
    assert (out["train"].columns, out["test"].columns) == (["x"], ["x"])


def test_leave_out_of_a_column_the_rows_lack_is_an_error() -> None:
    rows = pl.DataFrame({"x": [1]})
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        leave_out(rows, rows, ["sku"])
