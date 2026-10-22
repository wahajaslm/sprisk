import math
from datetime import date, datetime

import polars as pl
import pytest

from sprisk_clean.date_parts import date_parts

# 2024-03-04 is a Monday; 2023-12-31 a Sunday.
TRAIN = pl.DataFrame({"opened": [date(2024, 3, 4), date(2023, 12, 31)], "age": [30, 40]})
TEST = pl.DataFrame({"opened": [date(2025, 6, 7), None], "age": [50, 60]})


def test_a_date_becomes_its_year_month_and_weekday_and_the_date_is_dropped() -> None:
    train = date_parts(TRAIN, TEST, columns=["opened"])["train"]
    assert train.columns == [
        "age",
        "opened_year",
        "opened_month",
        "opened_weekday",
        "opened_month_sin",
        "opened_month_cos",
        "opened_weekday_sin",
        "opened_weekday_cos",
    ]
    assert train["opened_year"].to_list() == [2024, 2023]
    assert train["opened_month"].to_list() == [3, 12]
    assert train["opened_weekday"].to_list() == [1, 7]


def test_months_and_weekdays_are_also_on_a_circle_so_december_is_next_to_january() -> None:
    train = date_parts(TRAIN, TEST, columns=["opened"])["train"]
    assert train["opened_month_sin"].to_list() == pytest.approx(
        [math.sin(2 * math.pi * 3 / 12), math.sin(2 * math.pi)], abs=1e-12
    )
    assert train["opened_month_cos"][1] == pytest.approx(1.0)
    assert train["opened_weekday_cos"][1] == pytest.approx(1.0)


def test_test_rows_get_the_same_parts_and_a_gap_stays_a_gap() -> None:
    test = date_parts(TRAIN, TEST, columns=["opened"])["test"]
    assert test["opened_year"].to_list() == [2025, None]
    assert test["opened_weekday"].to_list() == [6, None]
    assert test["opened_month_sin"][1] is None


def test_a_date_and_time_works_too() -> None:
    train = pl.DataFrame({"at": [datetime(2024, 3, 4, 13, 5)]})
    out = date_parts(train, train, columns=["at"])["train"]
    assert out.row(0)[:3] == (2024, 3, 1)


def test_a_text_column_is_refused() -> None:
    text = pl.DataFrame({"opened": ["2024-03-04"]})
    with pytest.raises(ValueError, match="opened is not a date"):
        date_parts(text, text, columns=["opened"])


def test_a_new_column_may_not_replace_an_existing_one() -> None:
    clash = TRAIN.with_columns(pl.lit(1).alias("opened_year"))
    with pytest.raises(ValueError, match="opened_year is already a column"):
        date_parts(clash, TEST, columns=["opened"])
