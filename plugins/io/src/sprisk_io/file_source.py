from pathlib import Path
from typing import Any

import polars as pl


def file_source(path: Path, format: str, missing_values: list[str] | None = None) -> pl.DataFrame:
    """Read a local CSV or Parquet file. In a CSV, empty cells and `missing_values` are missing.
    A column with no name, such as the row index pandas writes, is named `unnamed_<position>`,
    since no step can name a column by the empty text."""
    if not path.is_file():
        raise ValueError(f"no file at {path}")
    if format == "parquet":
        table = pl.read_parquet(path)
    else:
        table = pl.read_csv(
            path, null_values=missing_values if missing_values is not None else ["NA"]
        )
    return name_nameless(table)


def name_nameless(table: pl.DataFrame) -> pl.DataFrame:
    names = {c: f"unnamed_{i}" for i, c in enumerate(table.columns) if c == ""}
    if taken := set(names.values()) & set(table.columns):
        raise ValueError(f"a nameless column cannot be named {', '.join(sorted(taken))}: taken")
    return table.rename(names)


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. `outputs` names the variable the table goes by."""
    data, path = outputs["data"], settings["path"]
    if settings["format"] == "parquet":
        read = f"pl.read_parquet({path!r})"
    else:
        missing = settings.get("missing_values", ["NA"])
        read = f"pl.read_csv({path!r}, null_values={missing!r})"
    return (
        f"import polars as pl\n\n{data} = {read}\n"
        "# A column with no name is named by its position.\n"
        f"{data} = {data}.rename(\n"
        f"    {{c: f'unnamed_{{i}}' for i, c in enumerate({data}.columns) if c == ''}}\n"
        ")\n"
    )
