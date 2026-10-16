from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl

from sprisk_clean.train_test import read_pair, write_pair
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import Output


def clip_outliers(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """Clip to the train IQR fence [q1 - k*IQR, q3 + k*IQR]. Rows are never dropped."""
    columns, k = params["columns"], params["k"]
    train, test = read_pair(inputs, columns)
    exprs = []
    for c in columns:
        q1, q3 = train[c].quantile(0.25, "linear"), train[c].quantile(0.75, "linear")
        if q1 is None or q3 is None:
            raise OperatorError("no_train_values", f"column {c} has no values in train")
        iqr = q3 - q1
        exprs.append(pl.col(c).clip(q1 - k * iqr, q3 + k * iqr))
    return write_pair(train.with_columns(exprs), test.with_columns(exprs), out_dir)
