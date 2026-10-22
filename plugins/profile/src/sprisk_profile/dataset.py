"""A descriptive profile of one table for the Datasets view (ADR-0038).

Run as `python -m sprisk_profile.dataset` with a Parquet path on stdin; prints a
`DatasetProfile` as JSON. Rust starts one short process per request, bounds its time and
checks the answer against the contract. Methodology rules read it too: of a step's train rows
(ADR-0042), or only its structure (types, duplicates, values that do not read as numbers) of the
rows before the split (ADR-0059), since statistics of all rows see held-out rows.
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
# Most distinct values a column may have and still report its rarest value's share: enough for
# the classes of a target, few enough that the share means something.
MAX_RARE_VALUES = 20
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
    duplicates = _duplicates(
        data,
        data.height if total_rows is None else total_rows,
        width if total_columns is None else total_columns,
    )
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
        **({} if duplicates is None else {"duplicate_rows": duplicates}),
        "columns": [_column(data[name], name in numeric, bins, band_rows) for name in data.columns],
        "correlation": {"columns": varying, "pairs": _pairs(data, varying)},
    }


def _duplicates(data: pl.DataFrame, rows: int, columns: int) -> int | None:
    """Rows equal in every column to an earlier one, as drop_duplicates compares them (NaN
    equals NaN, not a gap). None when the table has rows or columns the profile does not read:
    rows equal here may differ there, and copies may sit past the cut."""
    if rows > data.height or columns > MAX_COLUMNS or data.width > MAX_COLUMNS:
        return None
    return data.height - data.n_unique() if data.height else 0


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
    if (rarest := _rarest_share(s)) is not None:
        column["rarest_share"] = rarest
    if numeric:
        column.update(_shape(s))
    if s.dtype == pl.String:
        column.update(_conversion(s))
        column.update(_spelling(s))
    histogram = _bins(bins, s.name) if numeric else _top_values(s)
    if histogram is not None:
        column["histogram"] = histogram
    return column


def _rarest_share(s: pl.Series) -> float | None:
    """The share of present values held by the least common one, for a column with few values
    (a target's rarest class). Renamed first: the column's own name could be "n" (rule 7)."""
    present = s.drop_nulls()
    if present.is_empty() or s.dtype.is_nested() or present.n_unique() > MAX_RARE_VALUES:
        return None
    counts: list[int] = present.rename("value").value_counts(name="n")["n"].to_list()
    return min(counts) / present.len()


def _shape(s: pl.Series) -> dict[str, float]:
    """Skew, excess kurtosis, the IQR and the share outside the 1.5 x IQR fences, for scaling
    and outlier rules. A column without variation has no shape, so it gets none."""
    present = s.drop_nulls().cast(pl.Float64)
    if present.n_unique() < 2:
        return {}
    q1, q3 = present.quantile(0.25, "linear"), present.quantile(0.75, "linear")
    shape: dict[str, float] = {}
    # Unbiased (bias=False), as SciPy reports them: small train partitions are common.
    if (skew := present.skew(bias=False)) is not None and math.isfinite(skew):
        shape["skewness"] = skew
    if (kurtosis := present.kurtosis(bias=False)) is not None and math.isfinite(kurtosis):
        shape["kurtosis"] = kurtosis
    if q1 is not None and q3 is not None:
        shape["iqr"] = q3 - q1
        fence = 1.5 * (q3 - q1)
        outside = ((present < q1 - fence) | (present > q3 + fence)).sum()
        shape["outlier_share"] = float(outside) / present.len()
    return shape


def _conversion(s: pl.Series) -> dict[str, Any]:
    """For missing-marker and type rules: the share of a text column's present values that read
    as finite numbers, how many of those start with a zero like the code 01234, and the most
    common values that do not read as numbers ("?", "n/a", "NaN") when some do. Spaces around a
    number are ignored, as cast_types ignores them; values that are not numbers are given as
    they are, so mark_missing can match them whole."""
    present = s.drop_nulls()
    if present.is_empty():
        return {}
    trimmed = present.str.strip_chars()
    as_number = trimmed.cast(pl.Float64, strict=False)
    numbers = as_number.is_not_null() & as_number.is_finite()
    share = float(numbers.sum()) / present.len()
    zeros = int((numbers & trimmed.str.contains(r"^[+-]?0\d")).sum())
    if share in (0.0, 1.0):
        return {"numeric_share": share, "leading_zero_values": zeros}
    counts = (
        present.filter(~numbers)
        .rename("value")
        .value_counts(name="n")
        .sort(["n", "value"], descending=[True, False])
        .head(TOP_VALUES)
    )
    return {
        "numeric_share": share,
        "leading_zero_values": zeros,
        "unconverted": [v[:MAX_LABEL] for v in counts["value"]],
    }


def _spelling(s: pl.Series) -> dict[str, int]:
    """For the text spelling rule: how many distinct values merge with another once spaces and
    case are ignored, and how many more once accents are too (OpenRefine's key collision).
    Blank values are left out: they are gaps, not spellings. NFD splits only accents off, so
    'm²' and 'm2' stay apart."""
    present = s.drop_nulls().unique()
    present = present.filter(present.str.strip_chars() != "")
    folded = present.str.strip_chars().str.replace_all(r"\s+", " ").str.to_lowercase()
    unaccented = folded.str.normalize("NFD").str.replace_all(r"\p{M}", "")
    return {
        "case_variants": present.len() - folded.n_unique(),
        "accent_variants": folded.n_unique() - unaccented.n_unique(),
    }


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
