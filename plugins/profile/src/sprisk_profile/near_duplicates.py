from typing import Any

import polars as pl

from .group_sizes import records_per_item

GROUP = "item_group"
KIND = "data.near_duplicate_groups"


def near_duplicates(data: pl.DataFrame, title_column: str) -> dict[str, Any]:
    """Groups rows whose titles match once case, accents, spacing and punctuation go, in a
    new item_group column, and measures how many rows share a title. Exact matches only:
    fuzzy matching would need connected components over pairs."""
    if GROUP in data.columns:
        raise ValueError(f"the table already has a column {GROUP}")
    kind = data.schema[title_column]
    if kind != pl.String:
        raise ValueError(f"{title_column} holds {kind}, not text")
    key = (
        pl.col(title_column)
        .str.normalize("NFKD")
        .str.replace_all(r"\p{M}", "")
        .str.to_lowercase()
        .str.replace_all(r"[^\p{L}\p{N}]+", " ")
        .str.strip_chars()
    )
    # A missing title says nothing about the item, so such a row is its own group.
    keyed = data.with_row_index("_row").with_columns(
        pl.when(key.fill_null("") == "")
        .then(pl.format("\x00{}", pl.col("_row")))
        .otherwise(key)
        .alias("_key")
    )
    grouped = keyed.with_columns(pl.col("_key").rank("dense").cast(pl.Int64).alias(GROUP))
    sizes = grouped.group_by(GROUP).len()["len"]
    repeated = sizes.filter(sizes > 1)
    return {
        "data": grouped.drop("_row", "_key"),
        "evidence": {
            KIND: {
                "rows": data.height,
                "groups": repeated.len(),
                "rows_in_groups": int(repeated.sum()),
                "largest_group": max(sizes.to_list(), default=0),
            }
        },
        "figures": records_per_item(sizes, f"Rows per title group ({title_column})"),
    }
