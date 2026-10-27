"""A descriptive profile of one table for the Datasets view (ADR-0038).

Run as `python -m sprisk_profile.dataset` with a Parquet path on stdin, and the label column on
a second line when the page asks how columns relate to it; prints a
`DatasetProfile` as JSON. Rust starts one short process per request, bounds its time and
checks the answer against the contract. Methodology rules read it too: of a step's train rows
(ADR-0042), or only its structure (types, duplicates, values that do not read as numbers) of the
rows before the split (ADR-0059), since statistics of all rows see held-out rows.
"""

import json
import math
import operator
import sys
from functools import reduce
from itertools import combinations
from typing import Any

import polars as pl

from .distributions import histogram_bins, numeric_columns
from .label import label_profile
from .understanding import findings, role

MAX_BANDS = 40
MAX_CORRELATED = 30
# A correlation from fewer rows than this says little; it is left out rather than drawn as exact.
MIN_PAIRED = 10
TOP_VALUES = 30
# Values that do not read as numbers, named for the missing-marker rule.
UNCONVERTED = 10
QUARTILES = (("min", 0.0), ("q1", 0.25), ("median", 0.5), ("q3", 0.75), ("max", 1.0))
# Bars of a words-per-value histogram.
WORD_BINS = 20
# Most distinct values a column may have and still report its rarest value's share: enough for
# the classes of a target, few enough that the share means something.
MAX_RARE_VALUES = 20
# Column pairs listed as missing together, and the gappiest columns paired to find them.
CO_MISSING = 5
MAX_GAPPY = 30
# Bounds on the work and memory of one profile; the page says when a table is larger.
MAX_COLUMNS = 200
MAX_ROWS = 1_000_000
# Values come from the dataset (untrusted, rule 7) and are shown as text; long ones are cut.
MAX_LABEL = 60
# An HTML tag or comment starts with a letter or "!--" after "<" ("<br />", "</p>"), so
# "5 < 7" is not one; an entity is named or numbered and ends in ";" ("&eacute;", "&#233;"),
# so "AT&T" is not one. The strip_html step changes exactly the values this matches.
HTML = (
    r"<!--(?s:.*?)-->|</?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?/?>"
    r"|&(#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);"
)


def read_table(
    path: str, max_rows: int = MAX_ROWS, max_columns: int = MAX_COLUMNS
) -> tuple[pl.DataFrame, int, int]:
    """The first rows and columns of a Parquet file, and its true row and column counts."""
    names = list(pl.read_parquet_schema(path))
    rows = pl.scan_parquet(path).select(pl.len()).collect().item()
    return pl.read_parquet(path, columns=names[:max_columns], n_rows=max_rows), rows, len(names)


def profile(
    data: pl.DataFrame,
    total_rows: int | None,
    total_columns: int | None = None,
    target: str | None = None,
) -> dict[str, Any]:
    """`total_rows` None: the table has more rows than `data` and nobody counted them
    (ADR-0067), so the total is left out and rows equal to an earlier one are not counted."""
    width = data.width
    columns_total = width if total_columns is None else total_columns
    duplicates = None if total_rows is None else _duplicates(data, total_rows, columns_total)
    data = _finite(data.select(data[n] for n in data.columns[:MAX_COLUMNS]))
    rows = data.height
    band_rows = -(-rows // MAX_BANDS)
    numeric = numeric_columns(data)
    bins = histogram_bins(data, numeric)
    columns = [_column(data[name], name in numeric, bins, band_rows) for name in data.columns]
    # Identifiers and category codes are numbers only in type; their correlation means nothing.
    measured = [c["name"] for c in columns if c["role"] == "number"]
    varying = [c for c in measured if data[c].drop_nulls().n_unique() > 1][:MAX_CORRELATED]
    label = None if target is None else label_profile(data, columns, target)
    return {
        **({} if total_rows is None else {"total_rows": total_rows}),
        "total_columns": columns_total,
        "profiled_rows": rows,
        "band_rows": band_rows,
        **({} if duplicates is None else {"duplicate_rows": duplicates}),
        "rows_with_gap": _rows_with_gap(data),
        "co_missing": _co_missing(data),
        "columns": columns,
        "correlation": {"columns": varying, "pairs": _pairs(data, varying)},
        "findings": findings(data, columns, duplicates),
        **({} if label is None else {"label": label}),
    }


def _duplicates(data: pl.DataFrame, rows: int, columns: int) -> int | None:
    """Rows equal in every column to an earlier one, as drop_duplicates compares them (NaN
    equals NaN, not a gap). None when the table has rows or columns the profile does not read:
    rows equal here may differ there, and copies may sit past the cut."""
    if rows > data.height or columns > MAX_COLUMNS or data.width > MAX_COLUMNS:
        return None
    return data.height - data.n_unique() if data.height else 0


def _gap(s: pl.Series) -> pl.Series:
    """A missing cell or blank text: both are gaps a step must fill before a model sees them."""
    if s.dtype == pl.String:
        return s.is_null() | (s.str.strip_chars() == "")
    return s.is_null()


def _rows_with_gap(data: pl.DataFrame) -> int:
    """Rows with a gap, from the columns as series: a name is never read as a pattern."""
    gaps = [_gap(s) for s in data]
    return int(reduce(operator.or_, gaps).sum()) if gaps else 0


def _co_missing(data: pl.DataFrame) -> list[dict[str, Any]]:
    """The column pairs most often missing in the same rows: gaps that come together usually
    share a cause, such as a source that never filled either."""
    gaps = [(s.name, _gap(s)) for s in data]
    gappy = sorted((g for g in gaps if g[1].any()), key=lambda g: -int(g[1].sum()))
    pairs = [(int((a & b).sum()), x, y) for (x, a), (y, b) in combinations(gappy[:MAX_GAPPY], 2)]
    top = sorted((p for p in pairs if p[0] > 0), key=lambda p: -p[0])[:CO_MISSING]
    return [{"column_a": a, "column_b": b, "rows": n} for n, a, b in top]


def _finite(data: pl.DataFrame) -> pl.DataFrame:
    """NaN and infinity count as missing: they have no place in a histogram or in JSON.
    Columns are taken as series, never by `pl.col(name)`: a dataset's column name (untrusted,
    rule 7) like `^.*$` would be read as a pattern there."""
    floats = [data[n] for n, t in data.schema.items() if t.is_float()]
    return data.with_columns(
        pl.select(pl.when(s.is_finite()).then(s)).to_series().alias(s.name) for s in floats
    )


def _column(s: pl.Series, numeric: bool, bins: pl.DataFrame, band_rows: int) -> dict[str, Any]:
    column: dict[str, Any] = {
        "name": s.name,
        "data_type": str(s.dtype)[:MAX_LABEL],
        "missing": s.null_count(),
        "distinct": s.drop_nulls().n_unique(),
        "missing_by_band": _missing_by_band(s, band_rows),
    }
    if (rarest := _rarest_share(s)) is not None:
        column["rarest_share"] = rarest
    if s.dtype == pl.String:
        column.update(conversion(s))
        column.update(spelling(s))
        column.update(words(s))
        column.update(html(s))
        column["blank"] = int((s.drop_nulls().str.strip_chars() == "").sum())
    column["role"] = role(s, column.get("word_share"))
    # Storage type is not analytical meaning: integer identifiers and integer class codes must
    # not acquire a mean, quartiles, or range bins merely because they are physically numeric.
    # Infer the observed role first, then compute numeric statistics only for measured numbers.
    if column["role"] == "number":
        column.update(shape(s))
        if (quartiles := _quartiles(s)) is not None:
            column["quartiles"] = quartiles
    if column["role"] == "text" and (counted := _word_counts(s)) is not None:
        column["word_counts"] = counted
    histogram = (
        _bins(bins, s.name)
        if column["role"] == "number"
        else _top_values(s)
        if column["role"] in ("category", "boolean", "text")
        else None
    )
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


def shape(s: pl.Series) -> dict[str, Any]:
    """Mean, spread, skew, excess kurtosis, the IQR and the 1.5 x IQR fences with the values
    outside them, for scaling and outlier rules. A column without variation has no shape, so it
    gets only its mean."""
    present = s.drop_nulls().cast(pl.Float64)
    found: dict[str, Any] = {} if present.is_empty() else {"mean": present.mean()}
    if present.n_unique() < 2:
        return found
    q1, q3 = present.quantile(0.25, "linear"), present.quantile(0.75, "linear")
    found["std"] = present.std()
    # Unbiased (bias=False), as SciPy reports them: small train partitions are common.
    if (skew := present.skew(bias=False)) is not None and math.isfinite(skew):
        found["skewness"] = skew
    if (kurtosis := present.kurtosis(bias=False)) is not None and math.isfinite(kurtosis):
        found["kurtosis"] = kurtosis
    if q1 is not None and q3 is not None:
        found["iqr"] = q3 - q1
        fence = 1.5 * (q3 - q1)
        outside = int(((present < q1 - fence) | (present > q3 + fence)).sum())
        found["outlier_share"] = float(outside) / present.len()
        found["fences"] = {"low": q1 - fence, "high": q3 + fence}
        found["outliers"] = outside
    return found


def conversion(s: pl.Series) -> dict[str, Any]:
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
        .head(UNCONVERTED)
    )
    return {
        "numeric_share": share,
        "leading_zero_values": zeros,
        "unconverted": [v[:MAX_LABEL] for v in counts["value"]],
    }


def spelling(s: pl.Series) -> dict[str, int]:
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


def words(s: pl.Series) -> dict[str, float]:
    """For the column-roles rule: the share of a text column's present values holding more
    than one word once trimmed. Codes and identifiers hold one; titles and descriptions more."""
    present = s.drop_nulls()
    if present.is_empty():
        return {}
    several = present.str.strip_chars().str.contains(r"\s")
    return {"word_share": float(several.sum()) / present.len()}


def html(s: pl.Series) -> dict[str, float]:
    """For the HTML text rule: the share of a text column's present values holding an HTML tag
    or entity, which a word count would take for words ("br", "eacute")."""
    present = s.drop_nulls()
    if present.is_empty():
        return {}
    return {"html_share": float(present.str.contains(HTML).sum()) / present.len()}


def _missing_by_band(s: pl.Series, band_rows: int) -> list[float]:
    if band_rows == 0:
        return []
    shares = (
        pl.DataFrame({"m": _gap(s)})
        .with_row_index()
        .group_by(pl.col("index") // band_rows, maintain_order=True)
        .agg(pl.col("m").mean())
    )
    return [round(v, 4) for v in shares["m"]]


def _bins(bins: pl.DataFrame, name: str) -> dict[str, Any] | None:
    rows = bins.filter(pl.col("column_name") == name).iter_rows(named=True)
    bars = [
        {
            "label": _range(r["bin_lower"], r["bin_upper"]),
            "lower": r["bin_lower"],
            "upper": r["bin_upper"],
            "count": r["count"],
        }
        for r in rows
    ]
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
    return {"kind": "top_values", "bars": bars, "other": present.len() - int(counts["n"].sum())}


def _quartiles(s: pl.Series) -> dict[str, float] | None:
    present = s.drop_nulls().cast(pl.Float64)
    q = {k: present.quantile(p, "linear") for k, p in QUARTILES}
    if any(v is None for v in q.values()):
        return None
    return {k: float(v) for k, v in q.items() if v is not None}


def _word_counts(s: pl.Series) -> dict[str, Any] | None:
    """Words per non-blank value: one bar per count while there are at most WORD_BINS counts,
    else WORD_BINS equal ranges of whole words."""
    counts = s.drop_nulls().str.count_matches(r"\S+")
    counts = counts.filter(counts > 0)
    if counts.is_empty():
        return None
    low, high = int(counts.min()), int(counts.max())  # type: ignore[arg-type]
    width = -(-(high - low + 1) // WORD_BINS)
    buckets = ((counts - low) // width).rename("b").value_counts(name="n").sort("b")
    bars = []
    for b, n in buckets.iter_rows():
        lo = low + b * width
        hi = lo + width - 1
        bars.append({"label": str(lo) if width == 1 else f"{lo}–{hi}", "count": n})
    return {"kind": "bins", "bars": bars}


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
    # The path, and on a second line the label column when the page asks how columns relate.
    path, _, target = sys.stdin.read().strip().partition("\n")
    try:
        data, rows, columns = read_table(path)
    except (OSError, pl.exceptions.PolarsError) as e:
        sys.exit(f"cannot read {path}: {e}")
    # allow_nan=False: NaN is not JSON; _finite and _pairs make it impossible, so fail if not.
    made = profile(data, rows, columns, target.strip() or None)
    sys.stdout.write(json.dumps(made, allow_nan=False))


if __name__ == "__main__":
    main()
