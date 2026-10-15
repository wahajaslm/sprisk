from pathlib import Path

import polars as pl
import pytest
from conftest import WriteParquet
from split_runs import run_split

from sprisk_validation.temporal_split import temporal_split
from sprisk_workers.errors import OperatorError


def test_temporal_split_puts_all_train_strictly_before_test(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    df = pl.DataFrame({"t": [5, 1, 2, 2, 3, 3, 4, 4, 1, 5]})
    params: dict[str, object] = {"time_column": "t", "test_fraction": 0.3}
    train, test = run_split(temporal_split, params, write_parquet, out_dir, df)
    assert train["t"].max() < test["t"].min()  # type: ignore[operator]
    assert train.height + test.height == 10


@pytest.mark.parametrize(
    ("df", "code"),
    [
        (pl.DataFrame({"t": [1, None, 3, 4]}), "null_time_values"),
        (pl.DataFrame({"other": [1, 2]}), "missing_column"),
        (pl.DataFrame({"t": [1, 1, 1, 1]}), "empty_split"),
    ],
)
def test_temporal_split_rejects_bad_data(
    df: pl.DataFrame, code: str, write_parquet: WriteParquet, out_dir: Path
) -> None:
    params: dict[str, object] = {"time_column": "t", "test_fraction": 0.5}
    with pytest.raises(OperatorError) as e:
        run_split(temporal_split, params, write_parquet, out_dir, df)
    assert e.value.code == code
