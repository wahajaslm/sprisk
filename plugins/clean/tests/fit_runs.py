from pathlib import Path
from typing import Any

import polars as pl
from conftest import WriteParquet

from sprisk_workers.serve import OperatorFn


def run_fit(
    fn: OperatorFn,
    params: dict[str, Any],
    train: pl.DataFrame,
    test: pl.DataFrame,
    write: WriteParquet,
    out_dir: Path,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    inputs = {"train": write("train_in", train), "test": write("test_in", test)}
    outs = {o.port: pl.read_parquet(o.path) for o in fn(params, inputs, out_dir)}
    assert set(outs) == {"train", "test"}
    return outs["train"], outs["test"]
