from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl

from sprisk_validation.write_split import write_split
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import Output
from sprisk_workers.tables import read_table


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
    return write_split(df.filter(~is_test), df.filter(is_test), out_dir)
