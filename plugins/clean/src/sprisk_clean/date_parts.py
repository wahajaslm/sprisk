import math

import polars as pl


def _parts(c: str) -> list[pl.Expr]:
    # sin and cos put December next to January and Sunday next to Monday.
    month, weekday = pl.col(c).dt.month(), pl.col(c).dt.weekday()
    return [
        pl.col(c).dt.year().alias(f"{c}_year"),
        month.alias(f"{c}_month"),
        weekday.alias(f"{c}_weekday"),
        (2 * math.pi * month / 12).sin().alias(f"{c}_month_sin"),
        (2 * math.pi * month / 12).cos().alias(f"{c}_month_cos"),
        (2 * math.pi * weekday / 7).sin().alias(f"{c}_weekday_sin"),
        (2 * math.pi * weekday / 7).cos().alias(f"{c}_weekday_cos"),
    ]


def date_parts(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str]
) -> dict[str, pl.DataFrame]:
    """Each date column becomes its year, month and weekday (Monday 1), and month and
    weekday on a circle, in place of the date, which a model cannot read. Each row is
    worked out on its own: nothing is learned, so train and test are apart by design."""
    for c in columns:
        if train.schema[c] not in (pl.Date, pl.Datetime):
            raise ValueError(f"{c} is not a date; parse it as a date first")
    parts = [p for c in columns for p in _parts(c)]
    for name in (p.meta.output_name() for p in parts):
        if name in train.columns or name in test.columns:
            raise ValueError(f"{name} is already a column; rename it first")
    return {
        "train": train.with_columns(parts).drop(columns),
        "test": test.with_columns(parts).drop(columns),
    }
