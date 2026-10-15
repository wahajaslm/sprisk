from collections.abc import Iterable
from pathlib import Path

import polars as pl

from sprisk_workers.errors import OperatorError


def read_table(path: Path, required: Iterable[str] = ()) -> pl.DataFrame:
    df = pl.read_parquet(path)
    missing = sorted(set(required) - set(df.columns))
    if missing:
        raise OperatorError("missing_column", f"{path.name}: missing columns {missing}")
    return df
