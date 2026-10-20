import polars as pl


def clip_outliers(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str], k: float
) -> dict[str, pl.DataFrame]:
    """Clip to the train IQR fence [q1 - k*IQR, q3 + k*IQR]. Rows are never dropped.

    The fence comes from train only and is applied to both tables. NaN counts as missing."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    clipped = []
    for c in columns:
        q1, q3 = train[c].quantile(0.25, "linear"), train[c].quantile(0.75, "linear")
        if q1 is None or q3 is None:
            raise ValueError(f"column {c} has no values in train")
        iqr = q3 - q1
        if iqr == 0:
            raise ValueError(f"column {c} has no IQR spread in train; clipping would flatten it")
        clipped.append(pl.col(c).clip(q1 - k * iqr, q3 + k * iqr))
    return {"train": train.with_columns(clipped), "test": test.with_columns(clipped)}
