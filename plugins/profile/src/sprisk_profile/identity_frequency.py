"""How many records each stated item has (ADR-0065): the evidence the repeated-items method
reads when the question names the item column. Every row, before the split; it reads the
identifier, never the label."""

from typing import Any

import polars as pl

from .group_sizes import records_per_item

KIND = "data.identity_frequency"


def identity_frequency(data: pl.DataFrame, item_column: str) -> dict[str, Any]:
    """Items, repeated items and the rows they hold, plus rows with no identifier. A missing
    identifier names no item, so it is counted apart, never as one item."""
    if item_column not in data.columns:
        raise ValueError(f"the table has no column {item_column}")
    ids = data[item_column]
    sizes = ids.drop_nulls().value_counts()["count"]
    repeated = sizes.filter(sizes > 1)
    return {
        "evidence": {
            KIND: {
                "rows": data.height,
                "items": sizes.len(),
                "repeated_items": repeated.len(),
                "rows_in_repeated": int(repeated.sum()),
                "largest_item": max(sizes.to_list(), default=0),
                "missing": ids.null_count(),
            }
        },
        "figures": records_per_item(sizes, f"Records per item ({item_column})"),
    }
