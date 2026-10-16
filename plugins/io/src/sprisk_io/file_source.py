from pathlib import Path

import polars as pl


def file_source(path: str, format: str, missing_values: list[str] | None = None) -> pl.DataFrame:
    """Read a local CSV or Parquet file. In a CSV, empty cells and `missing_values` are missing."""
    src = Path(path)
    if not src.is_file():
        raise ValueError(f"no file at {src}")
    if format == "parquet":
        return pl.read_parquet(src)
    return pl.read_csv(src, null_values=missing_values if missing_values is not None else ["NA"])
