from pathlib import Path

import polars as pl
from conftest import WriteParquet
from fit_runs import run_fit

from sprisk_clean.clip_outliers import clip_outliers

TRAIN = pl.DataFrame({"x": [1.0, 2.0, 3.0, 4.0, 100.0]})
TEST = pl.DataFrame({"x": [-50.0, 3.0, 500.0]})


def test_clips_to_the_train_iqr_fence(write_parquet: WriteParquet, out_dir: Path) -> None:
    train, test = run_fit(
        clip_outliers, {"columns": ["x"], "k": 1.5}, TRAIN, TEST, write_parquet, out_dir
    )
    # Train quartiles 2 and 4, IQR 2, fence [-1, 7].
    assert train["x"].to_list() == [1.0, 2.0, 3.0, 4.0, 7.0]
    assert test["x"].to_list() == [-1.0, 3.0, 7.0]
    assert train.height == 5, "rows are clipped, never dropped"
