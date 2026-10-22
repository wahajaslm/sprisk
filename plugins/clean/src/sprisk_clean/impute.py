import polars as pl


def impute(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: list[str],
    method: str,
    text_fill: str | None = None,
) -> dict[str, pl.DataFrame]:
    """Fill gaps with a statistic of the train rows, applied to train and test alike.

    The statistic comes from train only, so nothing about the test rows leaks into it.
    NaN counts as missing. Text gaps get `text_fill`, a category of their own: a most-frequent
    fill would give a gap a value it never had."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    fills: dict[str, object] = {}
    for c in columns:
        dtype = train.schema[c]
        if dtype in (pl.String, pl.Categorical):
            if text_fill is None:
                raise ValueError(f"{c} is text: give a text_fill for its gaps")
            fills[c] = text_fill
            continue
        if not dtype.is_numeric():
            raise ValueError(f"{c} is {dtype}: impute fills numbers and text only")
        if method == "zero":
            fills[c] = 0.0
            continue
        value = train[c].median() if method == "median" else train[c].mean()
        if value is None:
            raise ValueError(f"column {c} has no values in train")
        fills[c] = value

    filled = [pl.col(c).fill_null(v) for c, v in fills.items()]
    return {"train": train.with_columns(filled), "test": test.with_columns(filled)}
