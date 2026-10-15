from pathlib import Path

import polars as pl
from conftest import WriteParquet

from sprisk_workers.serve import OperatorFn


def run_split(
    fn: OperatorFn, params: dict[str, object], write: WriteParquet, out_dir: Path, df: pl.DataFrame
) -> tuple[pl.DataFrame, pl.DataFrame]:
    outs = {o.port: pl.read_parquet(o.path) for o in fn(params, {"data": write("d", df)}, out_dir)}
    return outs["train"], outs["test"]
