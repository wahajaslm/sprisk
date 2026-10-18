"""A descriptive profile of one table for the Datasets view (ADR-0038).

Run as `python -m sprisk_profile.dataset` with a Parquet path on stdin; prints a
`DatasetProfile` as JSON. Rust starts one short process per request, bounds its time and
checks the answer against the contract. No step reads the profile; it only helps people see
their data.
"""

import json
import math
import sys
from itertools import combinations
from typing import Any

import polars as pl

from .distributions import histogram_bins, numeric_columns

MAX_BANDS = 40
MAX_CORRELATED = 30
# A correlation from fewer rows than this says little; it is left out rather than drawn as exact.
MIN_PAIRED = 10
TOP_VALUES = 10
# Bounds on the work and memory of one profile; the page says when a table is larger.
MAX_COLUMNS = 200
MAX_ROWS = 1_000_000
# Values come from the dataset (untrusted, rule 7) and are shown as text; long ones are cut.
MAX_LABEL = 60


def read_table(
    path: str, max_rows: int = MAX_ROWS, max_columns: int = MAX_COLUMNS
) -> tuple[pl.DataFrame, int, int]:
    """The first rows and columns of a Parquet file, and its true row and column counts."""
    names = list(pl.read_parquet_schema(path))
    rows = pl.scan_parquet(path).select(pl.len()).collect().item()
    return pl.read_parquet(path, columns=names[:max_columns], n_rows=max_rows), rows, len(names)


def profile(
    data: pl.DataFrame, total_rows: int | None = None, total_columns: int | None = None
) -> dict[str, Any]:
    width = data.width
    data = _finite(data.select(data[n] for n in data.columns[:MAX_COLUMNS]))
    rows = data.height
    band_rows = -(-rows // MAX_BANDS)
    numeric = numeric_columns(data)
    bins = histogram_bins(data, numeric)
    varying = [c for c in numeric if data[c].drop_nulls().n_unique() > 1][:MAX_CORRELATED]
    return {
        "total_rows": rows if total_rows is None else total_rows,
        "total_columns": width if total_columns is None else total_columns,
        "profiled_rows": rows,
        "band_rows": band_rows,
        "columns": [_column(data[name], name in numeric, bins, band_rows) for name in data.columns],
        "correlation": {"columns": varying, "pairs": _pairs(data, varying)},
    }


def _finite(data: pl.DataFrame) -> pl.DataFrame:
    """NaN and infinity count as missing: they have no place in a histogram or in JSON.
    Columns are taken as series, never by `pl.col(name)`: a dataset's column name (untrusted,
    rule 7) like `^.*$` would be read as a pattern there."""
    floats = [data[n] for n, t in data.schema.items() if t.is_float()]
    return data.with_columns(
        pl.select(pl.when(s.is_finite()).then(s)).to_series().alias(s.name) for s in floats
    )


def _column(s: pl.Series, numeric: bool, bins: pl.DataFrame, band_rows: int) -> dict[str, Any]:
    column = {
        "name": s.name,
        "data_type": str(s.dtype)[:MAX_LABEL],
        "missing": s.null_count(),
        "distinct": s.drop_nulls().n_unique(),
        "missing_by_band": _missing_by_band(s, band_rows),
    }
    histogram = _bins(bins, s.name) if numeric else _top_values(s)
    if histogram is not None:
        column["histogram"] = histogram
    return column


def _missing_by_band(s: pl.Series, band_rows: int) -> list[float]:
    if band_rows == 0:
        return []
    shares = (
        pl.DataFrame({"m": s.is_null()})
        .with_row_index()
        .group_by(pl.col("index") // band_rows, maintain_order=True)
        .agg(pl.col("m").mean())
    )
    return [round(v, 4) for v in shares["m"]]


def _bins(bins: pl.DataFrame, name: str) -> dict[str, Any] | None:
    rows = bins.filter(pl.col("column_name") == name).iter_rows(named=True)
    bars = [{"label": _range(r["bin_lower"], r["bin_upper"]), "count": r["count"]} for r in rows]
    return {"kind": "bins", "bars": bars} if bars else None


def _range(lo: float, hi: float) -> str:
    return f"{lo:.4g}" if lo == hi else f"{lo:.4g}–{hi:.4g}"


def _top_values(s: pl.Series) -> dict[str, Any] | None:
    present = s.drop_nulls()
    if present.is_empty() or s.dtype.is_nested():
        return None
    # Fixed names: the column's own name could be "count" (rule 7).
    counts = (
        present.cast(pl.String)
        .rename("value")
        .value_counts(name="n")
        .sort(["n", "value"], descending=[True, False])
        .head(TOP_VALUES)
    )
    bars = [{"label": v[:MAX_LABEL], "count": n} for v, n in counts.iter_rows()]
    return {"kind": "top_values", "bars": bars}


def _pairs(data: pl.DataFrame, columns: list[str]) -> list[dict[str, Any]]:
    """Pearson correlation of each pair over the rows where both are present. A pair with too
    few such rows, or no variation on them, has no meaningful value and is left out."""
    pairs = []
    for a, b in combinations(columns, 2):
        both = pl.DataFrame({"a": data[a], "b": data[b]}).drop_nulls()
        if both.height < MIN_PAIRED:
            continue
        r = both.select(pl.corr("a", "b")).item()
        if r is None or not math.isfinite(r):
            continue
        pairs.append({"column_a": a, "column_b": b, "pearson": r, "rows": both.height})
    return pairs


def main() -> None:
    path = sys.stdin.read().strip()
    try:
        data, rows, columns = read_table(path)
    except (OSError, pl.exceptions.PolarsError) as e:
        sys.exit(f"cannot read {path}: {e}")
    # allow_nan=False: NaN is not JSON; _finite and _pairs make it impossible, so fail if not.
    sys.stdout.write(json.dumps(profile(data, rows, columns), allow_nan=False))


if __name__ == "__main__":
    main()
