from pathlib import Path
from typing import Any

import polars as pl


def file_source(path: Path, format: str, missing_values: list[str] | None = None) -> pl.DataFrame:
    """Read a local CSV or Parquet file. In a CSV, empty cells and `missing_values` are missing."""
    if not path.is_file():
        raise ValueError(f"no file at {path}")
    if format == "parquet":
        return pl.read_parquet(path)
    return pl.read_csv(path, null_values=missing_values if missing_values is not None else ["NA"])


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. `outputs` names the variable the table goes by."""
    data, path = outputs["data"], settings["path"]
    if settings["format"] == "parquet":
        return f"import polars as pl\n\n{data} = pl.read_parquet({path!r})\n"
    missing = settings.get("missing_values", ["NA"])
    return f"import polars as pl\n\n{data} = pl.read_csv({path!r}, null_values={missing!r})\n"
