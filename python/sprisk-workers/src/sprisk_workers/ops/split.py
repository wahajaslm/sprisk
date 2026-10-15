from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl

from sprisk_workers.errors import OperatorError
from sprisk_workers.ops.tables import read_table
from sprisk_workers.output import PARQUET, Output


def random_split(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    df = read_table(inputs["data"]).sample(fraction=1.0, shuffle=True, seed=params["seed"])
    n_test = round(df.height * params["test_fraction"])
    return _write(df.slice(n_test), df.head(n_test), out_dir)


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
    outputs = []
    for port, df in (("train", train), ("test", test)):
        path = out_dir / f"{port}.parquet"
        df.write_parquet(path)
        outputs.append(Output(port, path, PARQUET))
    return outputs
