from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl

from sprisk_clean.train_test import read_pair, write_pair
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import Output


def scale(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
    """Min-max or z-score with the train range or moments; test may fall outside [0, 1]."""
    columns, method = params["columns"], params["method"]
    train, test = read_pair(inputs, columns)
    exprs = []
    for c in columns:
        if method == "min_max":
            low, high = train[c].min(), train[c].max()
            centre, spread = low, (None if low is None or high is None else high - low)
        else:
            centre, spread = train[c].mean(), train[c].std(ddof=0)
        if centre is None or not spread:
            raise OperatorError("constant_column", f"column {c} has no spread in train")
        exprs.append(((pl.col(c) - centre) / spread).alias(c))
    return write_pair(train.with_columns(exprs), test.with_columns(exprs), out_dir)
