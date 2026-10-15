from pathlib import Path

import polars as pl

from sprisk_workers.errors import OperatorError
from sprisk_workers.output import PARQUET, Output


def write_split(train: pl.DataFrame, test: pl.DataFrame, out_dir: Path) -> list[Output]:
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
