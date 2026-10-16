from pathlib import Path

import polars as pl
import pytest
from conftest import WriteParquet
from fit_runs import run_fit

from sprisk_clean.impute import impute
from sprisk_workers.errors import OperatorError

TRAIN = pl.DataFrame({"x": [1.0, 2.0, None, 100.0], "y": [1, 2, 3, 4]})
TEST = pl.DataFrame({"x": [None, 5.0], "y": [5, 6]})


@pytest.mark.parametrize(("method", "fill"), [("median", 2.0), ("mean", 103.0 / 3), ("zero", 0.0)])
def test_fills_test_gaps_with_a_statistic_of_train_only(
    method: str, fill: float, write_parquet: WriteParquet, out_dir: Path
) -> None:
    train, test = run_fit(
        impute, {"columns": ["x"], "method": method}, TRAIN, TEST, write_parquet, out_dir
    )
    assert test["x"].to_list() == pytest.approx([fill, 5.0])
    assert train["x"].null_count() == 0
    assert train["y"].to_list() == [1, 2, 3, 4], "other columns untouched"


def test_column_that_is_empty_in_train_is_an_error(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    empty = TRAIN.with_columns(pl.lit(None, dtype=pl.Float64).alias("x"))
    with pytest.raises(OperatorError) as e:
        run_fit(impute, {"columns": ["x"], "method": "mean"}, empty, TEST, write_parquet, out_dir)
    assert e.value.code == "no_train_values"


def test_nan_is_treated_as_missing(write_parquet: WriteParquet, out_dir: Path) -> None:
    train = pl.DataFrame({"x": [1.0, float("nan"), 3.0]})
    test = pl.DataFrame({"x": [float("nan")]})
    train_out, test_out = run_fit(
        impute, {"columns": ["x"], "method": "mean"}, train, test, write_parquet, out_dir
    )
    assert train_out["x"].to_list() == [1.0, 2.0, 3.0]
    assert test_out["x"].to_list() == [2.0]
