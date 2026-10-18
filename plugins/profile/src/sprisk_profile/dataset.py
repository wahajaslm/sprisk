"""A descriptive profile of one table for the Datasets view (ADR-0038).

Run as `python -m sprisk_profile.dataset` with a Parquet path on stdin; prints a
`DatasetProfile` as JSON. Rust starts one short process per request, bounds its time and
checks the answer against the contract. No step reads the profile; it only helps people see
their data.
"""

import json
import sys
from typing import Any

import polars as pl

from .distributions import correlations, histogram_bins, numeric_columns

MAX_BANDS = 40
MAX_CORRELATED = 30
TOP_VALUES = 10
# Values come from the dataset (untrusted, rule 7) and are shown as text; long ones are cut.
MAX_LABEL = 60


def profile(data: pl.DataFrame) -> dict[str, Any]:
    data = _finite(data)
    rows = data.height
    band_rows = -(-rows // MAX_BANDS)
    numeric = numeric_columns(data)
    bins = histogram_bins(data, numeric)
    varying = [c for c in numeric if data[c].drop_nulls().n_unique() > 1][:MAX_CORRELATED]
    return {
        "total_rows": rows,
        "total_columns": data.width,
        "band_rows": band_rows,
        "columns": [_column(data[name], name in numeric, bins, band_rows) for name in data.columns],
        "correlation": _matrix(correlations(data, varying), varying),
    }


def _finite(data: pl.DataFrame) -> pl.DataFrame:
    """NaN and infinity count as missing: they have no place in a histogram or in JSON."""
    floats = [n for n, t in data.schema.items() if t.is_float()]
    return data.with_columns(
        pl.when(pl.col(n).is_finite()).then(pl.col(n)).alias(n) for n in floats
    )


def _column(s: pl.Series, numeric: bool, bins: pl.DataFrame, band_rows: int) -> dict[str, Any]:
    column = {
        "name": s.name,
        "data_type": str(s.dtype),
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
    counts = (
        present.cast(pl.String)
        .value_counts(name="count")
        .sort(["count", s.name], descending=[True, False])
        .head(TOP_VALUES)
    )
    bars = [{"label": v[:MAX_LABEL], "count": n} for v, n in counts.iter_rows()]
    return {"kind": "top_values", "bars": bars}


def _matrix(pairs: pl.DataFrame, columns: list[str]) -> dict[str, Any]:
    """The pairs as a square matrix. A column with an undefined correlation (too few rows
    where both are present) is left out rather than given a made-up value."""
    value = {}
    for a, b, v in pairs.iter_rows():
        value[a, b] = value[b, a] = v
    kept = list(columns)
    for a in columns:
        if a in kept and any(value.get((a, b)) is None for b in kept if b != a):
            kept.remove(a)
    return {
        "columns": kept,
        "values": [[1.0 if a == b else value[a, b] for b in kept] for a in kept],
    }


def main() -> None:
    path = sys.stdin.read().strip()
    try:
        data = pl.read_parquet(path)
    except (OSError, pl.exceptions.PolarsError) as e:
        sys.exit(f"cannot read {path}: {e}")
    # allow_nan=False: NaN is not JSON; _finite should make it impossible, so fail if not.
    sys.stdout.write(json.dumps(profile(data), allow_nan=False))


if __name__ == "__main__":
    main()
