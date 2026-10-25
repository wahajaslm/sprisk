"""How the rows the split reads match the one loaded table no step reads (ADR-0063 slice 6):
the evidence the join method decides on. Only shared columns are compared; nothing is
fitted."""

from typing import Any

import polars as pl

from .keys import key_matches

KIND = "data.join_keys"


def join_keys(data: pl.DataFrame, other: pl.DataFrame) -> dict[str, Any]:
    """The columns both tables share and, when there is exactly one, how many rows find a
    match on it and the most rows of the other table one value finds."""
    found = key_matches(data.lazy(), other.lazy())
    keys = found["keys"]
    only = keys[0] if len(keys) == 1 else None
    return {
        KIND: {
            "rows": found["rows"],
            "shared": [k["column"] for k in keys],
            "key": only["column"] if only else "",
            "matched_rows": only["matched_rows"] if only else 0,
            "most_rows_per_key": only["most_rows_per_key"] if only else 0,
        }
    }
