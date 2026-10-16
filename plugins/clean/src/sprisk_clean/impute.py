from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl

from sprisk_clean.train_test import read_pair, write_pair
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import Output


def impute(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
    """Fill gaps with a statistic of the train rows, applied to train and test alike."""
    columns, method = params["columns"], params["method"]
    train, test = read_pair(inputs, columns)
    fills = {}
    for c in columns:
        if method == "zero":
            fills[c] = 0.0
            continue
        value = train[c].median() if method == "median" else train[c].mean()
        if value is None:
            raise OperatorError("no_train_values", f"column {c} has no values in train")
        fills[c] = value
    fill = [pl.col(c).fill_null(v) for c, v in fills.items()]
    return write_pair(train.with_columns(fill), test.with_columns(fill), out_dir)
