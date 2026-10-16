import polars as pl


def impute(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str], method: str
) -> dict[str, pl.DataFrame]:
    """Fill gaps with a statistic of the train rows, applied to train and test alike.

    The statistic comes from train only, so nothing about the test rows leaks into it.
    NaN counts as missing."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    fills: dict[str, object] = {}
    for c in columns:
        if method == "zero":
            fills[c] = 0.0
            continue
        value = train[c].median() if method == "median" else train[c].mean()
        if value is None:
            raise ValueError(f"column {c} has no values in train")
        fills[c] = value

    filled = [pl.col(c).fill_null(v) for c, v in fills.items()]
    return {"train": train.with_columns(filled), "test": test.with_columns(filled)}
