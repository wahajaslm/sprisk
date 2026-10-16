from pathlib import Path

import polars as pl
import pytest
from conftest import WriteParquet
from fit_runs import run_fit

from sprisk_clean.scale import scale
from sprisk_workers.errors import OperatorError

TRAIN = pl.DataFrame({"x": [0.0, 10.0]})
TEST = pl.DataFrame({"x": [5.0, 20.0]})


def test_min_max_uses_the_train_range_so_test_can_leave_zero_to_one(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    train, test = run_fit(
        scale, {"columns": ["x"], "method": "min_max"}, TRAIN, TEST, write_parquet, out_dir
    )
    assert train["x"].to_list() == [0.0, 1.0]
    assert test["x"].to_list() == [0.5, 2.0]


def test_z_score_uses_train_mean_and_std(write_parquet: WriteParquet, out_dir: Path) -> None:
    train, test = run_fit(
        scale, {"columns": ["x"], "method": "z_score"}, TRAIN, TEST, write_parquet, out_dir
    )
    assert train["x"].mean() == pytest.approx(0.0)
    assert test["x"].to_list() == pytest.approx([0.0, 15 / train_std()])


def train_std() -> float:
    std = TRAIN["x"].std(ddof=0)
    assert isinstance(std, float)
    return std


def test_constant_train_column_is_an_error(write_parquet: WriteParquet, out_dir: Path) -> None:
    flat = pl.DataFrame({"x": [3.0, 3.0]})
    with pytest.raises(OperatorError) as e:
        run_fit(scale, {"columns": ["x"], "method": "z_score"}, flat, TEST, write_parquet, out_dir)
    assert e.value.code == "constant_column"
