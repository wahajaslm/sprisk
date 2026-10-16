import polars as pl


def select_columns(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Keep only these columns, in this order."""
    return data.select(columns)


def drop_missing(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """Drop rows with a missing value (null or NaN) in any of these columns."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if data.schema[c].is_float()]
    return data.with_columns(nan_to_null).drop_nulls(columns)
