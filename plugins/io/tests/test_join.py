import polars as pl
import pytest

from sprisk_io.join import join

ITEMS = pl.DataFrame({"unnamed_0": [2, 0, 1], "designation": ["c", "a", "b"]})
CODES = pl.DataFrame({"unnamed_0": [0, 1, 2], "prdtypecode": [10, 2280, 50]})


def test_each_row_takes_the_other_table_s_columns_for_its_key_in_its_own_order() -> None:
    joined = join(ITEMS, CODES, "unnamed_0")
    assert joined.to_dicts() == [
        {"unnamed_0": 2, "designation": "c", "prdtypecode": 50},
        {"unnamed_0": 0, "designation": "a", "prdtypecode": 10},
        {"unnamed_0": 1, "designation": "b", "prdtypecode": 2280},
    ]


def test_a_row_whose_key_finds_nothing_stays_with_gaps() -> None:
    joined = join(ITEMS, CODES.filter(pl.col("unnamed_0") != 1), "unnamed_0")
    assert joined.height == 3
    assert joined["prdtypecode"].to_list() == [50, 10, None]


def test_a_key_the_other_table_repeats_is_refused_since_it_would_copy_rows() -> None:
    twice = pl.concat([CODES, CODES.head(1)])
    with pytest.raises(ValueError, match="more than one row for some unnamed_0"):
        join(ITEMS, twice, "unnamed_0")


def test_a_key_missing_from_either_table_is_refused() -> None:
    with pytest.raises(ValueError, match="id"):
        join(ITEMS, CODES, "id")


def test_another_shared_column_is_refused_since_it_is_ambiguous() -> None:
    with pytest.raises(ValueError, match="designation"):
        join(ITEMS, CODES.with_columns(designation=pl.lit("x")), "unnamed_0")


def test_keys_of_different_types_are_refused_naming_the_key() -> None:
    with pytest.raises(ValueError, match="unnamed_0.*type"):
        join(ITEMS, CODES.with_columns(pl.col("unnamed_0").cast(pl.String)), "unnamed_0")


def test_missing_keys_in_the_other_table_never_match_and_are_not_repeats() -> None:
    codes = pl.DataFrame({"unnamed_0": [0, 1, 2, None, None], "prdtypecode": [10, 20, 30, 1, 2]})
    assert join(ITEMS, codes, "unnamed_0")["prdtypecode"].to_list() == [30, 10, 20]
