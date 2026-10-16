import duckdb
import polars as pl


def summarize(data: pl.DataFrame) -> pl.DataFrame:
    """One row per column: type, range, mean, quartiles, distinct and missing counts (DuckDB)."""
    return duckdb.sql("SUMMARIZE SELECT * FROM data").pl()
