"""What the columns reaching a model are (ADR-0063 slice 6): the evidence the feature methods
decide on. It reads the model's train rows only, without the target."""

from typing import Any

import polars as pl

from .dataset import words

TEXT = "features.free_text"
DATES = "features.dates"
# Most categories one-hot encoding takes: text with at most this many values is a category,
# even when its values hold several words ("New York").
MAX_CATEGORIES = 15
# Share of values holding more than one word from which text is free text, not a code.
FREE_TEXT_WORD_SHARE = 0.5


def model_inputs(train: pl.DataFrame, target: str) -> dict[str, Any]:
    """Free text, category text and empty text columns, and date columns. `target` only
    names the column the worker drops before this runs."""
    free: list[str] = []
    categories: list[str] = []
    empty: list[str] = []
    for name, kind in train.schema.items():
        if kind != pl.String:
            continue
        distinct = train[name].drop_nulls().n_unique()
        if distinct == 0:
            empty.append(name)
        elif (
            distinct > MAX_CATEGORIES
            and words(train[name]).get("word_share", 0.0) >= FREE_TEXT_WORD_SHARE
        ):
            free.append(name)
        else:
            categories.append(name)
    dates = [n for n, kind in train.schema.items() if kind == pl.Date or kind == pl.Datetime]
    return {
        TEXT: {"columns": free, "categories": categories, "empty": empty},
        DATES: {"columns": dates},
    }
