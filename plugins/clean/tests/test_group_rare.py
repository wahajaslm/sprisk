import polars as pl
import pytest

from sprisk_clean.group_rare import group_rare

# car 3 of 6 rows, tv 2, boat 1: boat is rare at a share of 0.2.
TRAIN = pl.DataFrame({"purpose": ["car", "tv", "car", "boat", "car", "tv"], "age": [1] * 6})
TEST = pl.DataFrame({"purpose": ["boat", "tv", "plane"], "age": [2] * 3})


def test_a_category_rare_in_the_train_rows_becomes_other() -> None:
    out = group_rare(TRAIN, TEST, columns=["purpose"], min_share=0.2)
    assert out["train"]["purpose"].to_list() == ["car", "tv", "car", "other", "car", "tv"]
    assert out["train"]["age"].to_list() == [1] * 6


def test_test_rows_keep_only_the_categories_kept_on_train() -> None:
    test = group_rare(TRAIN, TEST, columns=["purpose"], min_share=0.2)["test"]
    assert test["purpose"].to_list() == ["other", "tv", "other"]


def test_a_category_exactly_at_the_share_is_kept() -> None:
    # tv is 2 of 6 rows: a third.
    out = group_rare(TRAIN, TEST, columns=["purpose"], min_share=2 / 6)
    assert out["train"]["purpose"].to_list() == ["car", "tv", "car", "other", "car", "tv"]


def test_a_gap_stays_a_gap() -> None:
    train = pl.DataFrame({"purpose": ["car", None, "car", "tv"]})
    out = group_rare(train, pl.DataFrame({"purpose": [None, "tv"]}), ["purpose"], min_share=0.3)
    assert out["train"]["purpose"].to_list() == ["car", None, "car", "other"]
    assert out["test"]["purpose"].to_list() == [None, "other"]


def test_category_columns_come_out_as_text() -> None:
    train = TRAIN.with_columns(pl.col("purpose").cast(pl.Categorical))
    out = group_rare(train, TEST, columns=["purpose"], min_share=0.2)
    assert out["train"]["purpose"].dtype == pl.String
    assert out["train"]["purpose"].to_list() == ["car", "tv", "car", "other", "car", "tv"]


def test_a_number_column_is_refused() -> None:
    with pytest.raises(ValueError, match="age is not text"):
        group_rare(TRAIN, TEST, columns=["age"], min_share=0.2)


def test_a_column_missing_from_either_table_is_a_column_error() -> None:
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        group_rare(TRAIN, TEST.drop("purpose"), columns=["purpose"], min_share=0.2)
