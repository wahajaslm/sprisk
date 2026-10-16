from pathlib import Path

import polars as pl


def file_source(path: Path, format: str, missing_values: list[str] | None = None) -> pl.DataFrame:
    """Read a local CSV or Parquet file. In a CSV, empty cells and `missing_values` are missing."""
    if not path.is_file():
        raise ValueError(f"no file at {path}")
    if format == "parquet":
        return pl.read_parquet(path)
    return pl.read_csv(path, null_values=missing_values if missing_values is not None else ["NA"])
