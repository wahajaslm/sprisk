from collections.abc import Mapping
from pathlib import Path

import polars as pl

from sprisk_workers.output import PARQUET, Output
from sprisk_workers.tables import read_table


def read_pair(inputs: Mapping[str, Path], columns: list[str]) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The train and test tables, each required to hold `columns`. NaN counts as missing."""
    train, test = read_table(inputs["train"], columns), read_table(inputs["test"], columns)
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    return train.with_columns(nan_to_null), test.with_columns(nan_to_null)


def write_pair(train: pl.DataFrame, test: pl.DataFrame, out_dir: Path) -> list[Output]:
    outputs = []
    for port, df in (("train", train), ("test", test)):
        path = out_dir / f"{port}.parquet"
        df.write_parquet(path)
        outputs.append(Output(port, path, PARQUET))
    return outputs
