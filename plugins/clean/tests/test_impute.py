import polars as pl
import pytest

from sprisk_clean.impute import impute

TRAIN = pl.DataFrame({"x": [1.0, 2.0, None, 100.0], "y": [1, 2, 3, 4]})
TEST = pl.DataFrame({"x": [None, 5.0], "y": [5, 6]})


@pytest.mark.parametrize(("method", "fill"), [("median", 2.0), ("mean", 103.0 / 3), ("zero", 0.0)])
def test_fills_test_gaps_with_a_statistic_of_train_only(method: str, fill: float) -> None:
    out = impute(TRAIN, TEST, columns=["x"], method=method)
    assert out["test"]["x"].to_list() == pytest.approx([fill, 5.0])
    assert out["train"]["x"].null_count() == 0
    assert out["train"]["y"].to_list() == [1, 2, 3, 4], "other columns untouched"


def test_column_that_is_empty_in_train_is_an_error() -> None:
    empty = TRAIN.with_columns(pl.lit(None, dtype=pl.Float64).alias("x"))
    with pytest.raises(ValueError, match="x has no values in train"):
        impute(empty, TEST, columns=["x"], method="mean")


def test_nan_is_treated_as_missing() -> None:
    train = pl.DataFrame({"x": [1.0, float("nan"), 3.0]})
    test = pl.DataFrame({"x": [float("nan")]})
    out = impute(train, test, columns=["x"], method="mean")
    assert out["train"]["x"].to_list() == [1.0, 2.0, 3.0]
    assert out["test"]["x"].to_list() == [2.0]
