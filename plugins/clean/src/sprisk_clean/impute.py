import polars as pl


def impute(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: list[str],
    method: str,
    text_fill: dict[str, str] | None = None,
    text_gap: str | None = None,
) -> dict[str, pl.DataFrame]:
    """Fill gaps with a statistic of the train rows, applied to train and test alike.

    The statistic comes from train only, so nothing about the test rows leaks into it.
    NaN counts as missing. Each text column's gaps get its `text_fill`: a category of their
    own, such as "missing", or "" for free text, where a gap is no words; `text_gap` is the
    fill of every text column `text_fill` leaves out. A most-frequent fill would give a gap a
    value it never had."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    fills: dict[str, object] = {}
    for c in columns:
        dtype = train.schema[c]
        if dtype in (pl.String, pl.Categorical):
            fill = (text_fill or {}).get(c, text_gap)
            if fill is None:
                raise ValueError(f"{c} is text: give it a text_fill or a text_gap for its gaps")
            # Empty text already means no words, as a gap filled with "" does.
            if fill and (
                (train[c].cast(pl.String) == fill).any() or (test[c].cast(pl.String) == fill).any()
            ):
                raise ValueError(f"{c} already has the value {fill!r}; pick another text_fill")
            fills[c] = fill
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
