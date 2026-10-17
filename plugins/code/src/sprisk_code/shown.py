"""What code shows, capped: a table as its first rows, long text cut. Shared by code steps and
the session kernel (ADR-0036). Imports no plotting library, so the kernel keeps its backend."""

from typing import Any

import polars as pl

MAX_TABLE_ROWS = 50
MAX_TABLE_COLUMNS = 50
MAX_CELL_CHARS = 500
MAX_TEXT_CHARS = 20_000
MAX_FIGURES = 12
MAX_ITEMS = 100
# SVG and chart JSON are text; a figure with very many points is noted, not shown.
MAX_FIGURE_BYTES = 2 * 1024 * 1024


def _is_pandas(value: object, *names: str) -> bool:
    # Checked by name: pandas is imported only by user code that made one.
    kind = type(value)
    return kind.__name__ in names and kind.__module__.split(".")[0] == "pandas"


def is_table(value: object) -> bool:
    return isinstance(value, pl.DataFrame) or _is_pandas(value, "DataFrame")


def as_polars(value: object) -> pl.DataFrame | None:
    """A table to summarise or show, whichever library made it."""
    if isinstance(value, pl.Series):
        return value.to_frame()
    if isinstance(value, pl.DataFrame):
        return value
    if _is_pandas(value, "DataFrame", "Series"):
        frame = pl.from_pandas(value)
        return frame.to_frame() if isinstance(frame, pl.Series) else frame
    return None


def table_page(df: pl.DataFrame, limit: int = MAX_TABLE_ROWS) -> dict[str, Any]:
    shown = df.select(df.columns[:MAX_TABLE_COLUMNS]).head(limit)
    rows = []
    for row in shown.iter_rows():
        missing = [i for i, v in enumerate(row) if v is None]
        values = ["" if v is None else cut(_text(v), MAX_CELL_CHARS) for v in row]
        rows.append({"values": values, "missing": missing})
    return {
        "offset": 0,
        "total_rows": df.height,
        "total_columns": df.width,
        "columns": [{"name": n, "data_type": str(t)} for n, t in shown.schema.items()],
        "rows": rows,
    }


def _text(value: Any) -> str:
    # Display only: six significant digits, like a notebook, not full float noise.
    return f"{value:.6g}" if isinstance(value, float) else str(value)


def cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"
