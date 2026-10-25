"""How a table's numeric columns differ from another's (ADR-0065): a split's train rows against
its test rows, for the Datasets Explore page.

Run as `python -m sprisk_profile.shift` with two Parquet paths on stdin, one per line; prints a
`TableShift` as JSON. Descriptive, for looking: it never feeds a decision. Columns are taken as
series, never by `pl.col(name)`: a dataset's column name is untrusted (rule 7).
"""

import json
import sys
from typing import Any

import numpy as np
import polars as pl
from scipy.stats import ks_2samp

from .dataset import MAX_COLUMNS, read_table
from .distributions import BINS, numeric_columns

MAX_SHIFTED = 30


def table_shift(data: pl.DataFrame, other: pl.DataFrame) -> dict[str, Any]:
    shared = [c for c in numeric_columns(data) if c in set(numeric_columns(other))][:MAX_COLUMNS]
    columns = [s for name in shared if (s := _shift(data[name], other[name])) is not None]
    columns.sort(key=lambda c: -float(c["ks"]))
    return {
        "schema_version": "sprisk.table_shift/v1",
        "rows": data.height,
        "other_rows": other.height,
        "columns": columns[:MAX_SHIFTED],
    }


def _present(s: pl.Series) -> np.ndarray:
    values = s.cast(pl.Float64).to_numpy()
    return values[np.isfinite(values)]


def _shift(a: pl.Series, b: pl.Series) -> dict[str, Any] | None:
    x, y = _present(a), _present(b)
    if x.size == 0 or y.size == 0:
        return None
    lo, hi = float(min(x.min(), y.min())), float(max(x.max(), y.max()))
    edges = np.linspace(lo, hi, BINS + 1) if hi > lo else np.array([lo, hi])
    return {
        "column": a.name,
        "ks": float(ks_2samp(x, y).statistic),
        "lower": lo,
        "upper": hi,
        "counts": [int(n) for n in np.histogram(x, bins=edges)[0]],
        "other_counts": [int(n) for n in np.histogram(y, bins=edges)[0]],
    }


def main() -> None:
    paths = sys.stdin.read().split("\n")
    paths = [p.strip() for p in paths if p.strip()]
    if len(paths) != 2:
        sys.exit(f"expected two Parquet paths, got {len(paths)}")
    left, right = paths
    try:
        data, _, _ = read_table(left)
        other, _, _ = read_table(right)
    except (OSError, pl.exceptions.PolarsError) as e:
        sys.exit(f"cannot read {left} and {right}: {e}")
    sys.stdout.write(json.dumps(table_shift(data, other), allow_nan=False))


if __name__ == "__main__":
    main()
