"""Which text columns hold HTML (ADR-0063 slice 6): the evidence the HTML text method decides
on. Every row, before the split; it reads text structure, never the label's values."""

from typing import Any

import polars as pl

from .dataset import html

KIND = "data.html_text"


def html_text(
    data: pl.DataFrame,
    target: str | None = None,
    item: str | None = None,
    time: str | None = None,
) -> dict[str, Any]:
    """Feature text columns whose values hold an HTML tag or entity, to strip, and the item
    and time columns that do, held as they are: a key with markup stays. The target is
    dropped before this runs."""
    # The worker drops the target before this runs; `target` only names it.
    held = {c for c in (item, time) if c is not None}
    marked = [
        name
        for name, kind in data.schema.items()
        if kind == pl.String and html(data[name]).get("html_share", 0.0) > 0
    ]
    return {
        KIND: {
            "columns": [c for c in marked if c not in held],
            "held": [c for c in marked if c in held],
        }
    }
