"""What the columns reaching a model are (ADR-0063 slice 6): the evidence the feature methods
decide on. It reads the model's train rows only, without the target."""

from typing import Any

import polars as pl

from .dataset import words

TEXT = "features.free_text"
DATES = "features.dates"
CATEGORIES = "features.categories"
GAPS = "features.gaps"
ENCODING = "features.encoding"
# Most categories one-hot encoding takes: text with at most this many values is a category,
# even when its values hold several words ("New York").
MAX_CATEGORIES = 15
# Share of values holding more than one word from which text is free text, not a code.
FREE_TEXT_WORD_SHARE = 0.5
# A category column with at least this many distinct values per train row is an identifier:
# most values occur once, so a category carries no shared signal.
IDENTIFIER_SHARE = 0.5
# A column at least this empty is not filled: most of its values would be made up.
MOSTLY_EMPTY_SHARE = 0.6
# A number skewed beyond this is filled with its median, which skew does not pull.
SKEWNESS = 1.5
# Fewest values a whole-number column needs before it may be category codes; two values are
# one 0/1 column either way.
MIN_CODE_VALUES = 3
CATEGORY_TYPES = (pl.String, pl.Categorical, pl.Enum, pl.Boolean)


def model_inputs(train: pl.DataFrame, target: str) -> dict[str, Any]:
    """Free text, category text and empty text columns; date columns; categories to group
    and to encode; and gaps to fill. `target` only names the column the worker drops before
    this runs."""
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
        CATEGORIES: _categories(train),
        GAPS: _gaps(train),
        ENCODING: _encoding(train),
    }


def _distinct(train: pl.DataFrame) -> dict[str, int]:
    return {name: train[name].drop_nulls().n_unique() for name in train.columns}


def _categories(train: pl.DataFrame) -> dict[str, list[str]]:
    """Category text with more values than one-hot takes: to group, or an identifier."""
    distinct = _distinct(train)
    wide = [
        n
        for n, kind in train.schema.items()
        if isinstance(kind, (pl.String, pl.Categorical)) and distinct[n] > MAX_CATEGORIES
    ]
    identifiers = [n for n in wide if distinct[n] >= IDENTIFIER_SHARE * train.height]
    return {"grouped": [n for n in wide if n not in identifiers], "identifiers": identifiers}


def _gaps(train: pl.DataFrame) -> dict[str, Any]:
    """Columns with gaps the impute step can fill, the statistic their numbers need, and
    those it cannot fill: mostly empty, or neither number nor text."""
    gappy = [n for n in train.columns if train[n].null_count()]
    mostly_empty = [n for n in gappy if train[n].null_count() >= MOSTLY_EMPTY_SHARE * train.height]
    unfillable = [
        n
        for n in gappy
        if n not in mostly_empty
        and not train.schema[n].is_numeric()
        and not isinstance(train.schema[n], (pl.String, pl.Categorical))
    ]
    columns = [n for n in gappy if n not in mostly_empty and n not in unfillable]
    skewed = any(
        abs(skew) > SKEWNESS
        for n in columns
        if train.schema[n].is_numeric()
        and (skew := train[n].drop_nulls().cast(pl.Float64).skew(bias=False)) is not None
    )
    return {
        "columns": columns,
        "method": "median" if skewed else "mean",
        "mostly_empty": mostly_empty,
        "unfillable": unfillable,
    }


def _encoding(train: pl.DataFrame) -> dict[str, list[str]]:
    """Categories one-hot takes, those too wide for it, and whole numbers that may be codes."""
    distinct = _distinct(train)
    categories = [n for n, kind in train.schema.items() if isinstance(kind, CATEGORY_TYPES)]
    codes = [
        n
        for n, kind in train.schema.items()
        if kind.is_integer() and MIN_CODE_VALUES <= distinct[n] <= MAX_CATEGORIES
    ]
    return {
        "few": [n for n in categories if distinct[n] <= MAX_CATEGORIES],
        "many": [n for n in categories if distinct[n] > MAX_CATEGORIES],
        "codes": codes,
    }
