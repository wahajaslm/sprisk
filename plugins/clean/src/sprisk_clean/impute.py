from typing import Literal

import polars as pl

from sprisk_workers.authoring import Columns, operator


@operator(
    id="impute",
    title="Imputation",
    stage="clean",
    inputs=["train", "test"],
    outputs=["train", "test"],
    fits_on_train=True,
)
def impute(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: Columns,
    method: Literal["median", "mean", "zero"],
    text_fill: dict[str, str] | None = None,
    text_gap: str | None = None,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Fill missing numbers with the train median or mean, or with 0, and missing text with a
    category of its own. Fit on train only.

    Args:
        columns: Columns whose missing values are filled.
        method: Statistic of the train rows used to fill gaps in numbers; zero fills with 0.
        text_fill: Each text column's fill for its gaps: a category such as missing, or an
            empty string for free text, where a gap is no words. Each text column needs one,
            or text_gap.
        text_gap: The fill for gaps in every text column text_fill does not name, such as
            missing.
    """
    # The statistic comes from train only, so nothing about the test rows leaks into it. A
    # most-frequent fill would give a gap a value it never had.
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
    return train.with_columns(filled), test.with_columns(filled)
