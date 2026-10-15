from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl
from sklearn.model_selection import train_test_split

from sprisk_workers.errors import OperatorError
from sprisk_workers.ops.tables import read_table, write_table
from sprisk_workers.output import PARQUET, Output


def random_split(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    df = read_table(inputs["data"]).with_row_index("_row")
    train_rows, _ = train_test_split(
        df["_row"].to_numpy(), test_size=params["test_fraction"], random_state=params["seed"]
    )
    is_train = pl.col("_row").is_in(train_rows.tolist())
    return _write(df.filter(is_train).drop("_row"), df.filter(~is_train).drop("_row"), out_dir)


def temporal_split(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """Train rows are strictly earlier than every test row; ties at the cutoff go to test."""
    column = params["time_column"]
    df = read_table(inputs["data"], [column])
    if df[column].null_count():
        raise OperatorError("null_time_values", f"{column} has {df[column].null_count()} nulls")
    cutoff = df[column].quantile(1 - params["test_fraction"], interpolation="lower")
    is_test = pl.col(column) >= cutoff
    return _write(df.filter(~is_test), df.filter(is_test), out_dir)


def _write(train: pl.DataFrame, test: pl.DataFrame, out_dir: Path) -> list[Output]:
    if train.is_empty() or test.is_empty():
        raise OperatorError(
            "empty_split", f"split gave {train.height} train and {test.height} test rows"
        )
    return [
        Output("train", write_table(train, out_dir / "train.parquet"), PARQUET),
        Output("test", write_table(test, out_dir / "test.parquet"), PARQUET),
    ]
