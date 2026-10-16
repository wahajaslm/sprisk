from collections.abc import Mapping
from itertools import combinations
from pathlib import Path
from typing import Any

import duckdb
import polars as pl

from sprisk_workers.output import PARQUET, Output

BINS = 20
NUMERIC = (
    "TINYINT",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "HUGEINT",
    "UTINYINT",
    "USMALLINT",
    "UINTEGER",
    "UBIGINT",
    "FLOAT",
    "DOUBLE",
    "DECIMAL",
)


def distributions(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """Equal-width histograms of numeric columns and their pairwise Pearson correlation,
    aggregated by DuckDB so the table is never loaded whole. Charts draw only these."""
    with duckdb.connect() as con:
        con.read_parquet(str(inputs["data"])).create_view("t")
        numeric = [
            name
            for name, dtype, *_ in con.sql("DESCRIBE t").fetchall()
            if dtype.startswith(NUMERIC)
        ]
        hist = pl.DataFrame(
            [row for name in numeric for row in _histogram(con, name)],
            schema={
                "column_name": pl.String,
                "bin_lower": pl.Float64,
                "bin_upper": pl.Float64,
                "count": pl.Int64,
            },
            orient="row",
        )
        corr = pl.DataFrame(
            _correlations(con, numeric),
            schema={"column_a": pl.String, "column_b": pl.String, "pearson": pl.Float64},
            orient="row",
        )
    hist_path, corr_path = out_dir / "histograms.parquet", out_dir / "correlation.parquet"
    hist.write_parquet(hist_path)
    corr.write_parquet(corr_path)
    return [
        Output(port="histograms", path=hist_path, media_type=PARQUET),
        Output(port="correlation", path=corr_path, media_type=PARQUET),
    ]


def _quote(name: str) -> str:
    # Column names come from the dataset, which is untrusted (rule 7).
    return '"' + name.replace('"', '""') + '"'


def _histogram(con: duckdb.DuckDBPyConnection, name: str) -> list[tuple[str, float, float, int]]:
    col = _quote(name)
    lo, hi, n = con.sql(
        f"SELECT min({col})::DOUBLE, max({col})::DOUBLE, count({col}) FROM t"
    ).fetchone() or (None, None, 0)
    if n == 0 or lo is None or hi is None:
        return []
    if lo == hi:
        return [(name, lo, hi, n)]
    width = (hi - lo) / BINS
    counts = dict(
        con.execute(
            f"SELECT least(floor(({col} - $lo) / $w), {BINS - 1})::INTEGER AS b, count(*) FROM t "
            f"WHERE {col} IS NOT NULL GROUP BY 1",
            {"lo": lo, "w": width},
        ).fetchall()
    )
    edges = [lo + i * width for i in range(BINS)] + [hi]
    return [(name, edges[i], edges[i + 1], counts.get(i, 0)) for i in range(BINS)]


def _correlations(
    con: duckdb.DuckDBPyConnection, numeric: list[str]
) -> list[tuple[str, str, float | None]]:
    pairs = list(combinations(numeric, 2))
    if not pairs:
        return []
    select = ", ".join(f"corr({_quote(a)}, {_quote(b)})" for a, b in pairs)
    values = con.sql(f"SELECT {select} FROM t").fetchone() or ()
    return [(a, b, v) for (a, b), v in zip(pairs, values, strict=True)]
