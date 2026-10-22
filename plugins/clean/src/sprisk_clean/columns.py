import polars as pl


def select_columns(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Keep only these columns, in this order."""
    return data.select(columns)


def drop_missing(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Drop rows with a missing value (null or NaN) in any of these columns."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if data.schema[c].is_float()]
    return data.with_columns(nan_to_null).drop_nulls(columns)


def drop_duplicates(data: pl.DataFrame, columns: list[str] | None = None) -> pl.DataFrame:
    """Keep the first of each set of rows equal in these columns (all when none are named),
    in the original order. Run before the split, so no row is in both train and test."""
    return data.unique(subset=columns, keep="first", maintain_order=True)


def mark_missing(data: pl.DataFrame, columns: list[str], values: list[str]) -> pl.DataFrame:
    """Text that stands for a gap, such as "?" or "n/a", becomes missing in these columns.
    Whole values only, so "n/a yet" stays."""
    for c in columns:
        if data.schema[c] != pl.String:
            raise ValueError(f"{c} is not text; only text columns hold gap markers")
    return data.with_columns(
        pl.when(pl.col(c).is_in(values)).then(None).otherwise(pl.col(c)).alias(c) for c in columns
    )
