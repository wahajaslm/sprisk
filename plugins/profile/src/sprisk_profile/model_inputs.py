"""What the columns reaching a model are (ADR-0063 slice 6): the evidence the feature methods
decide on. It reads the model's train rows only, without the target."""

from typing import Any

import polars as pl

from .dataset import shape, words

TEXT = "features.free_text"
DATES = "features.dates"
CATEGORIES = "features.categories"
GAPS = "features.gaps"
ENCODING = "features.encoding"
SKEW = "features.skew"
SCALING = "features.scaling"
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
# A number skewed past this gets a power transform: its long tail pulls a linear fit.
SKEW_TRANSFORM = 1.0
# Heavy tails, by excess kurtosis or the share outside the 1.5 x IQR fences, call for robust
# scaling, which the median and IQR keep steady.
HEAVY_KURTOSIS = 3.0
HEAVY_OUTLIER_SHARE = 0.05


def model_inputs(
    train: pl.DataFrame, target: str, item: str | None = None, time: str | None = None
) -> dict[str, Any]:
    """Free text, category text and empty text columns; date columns; categories to group
    and to encode; and gaps to fill. `target`, `item` and `time` only name the columns the
    worker drops before this runs."""
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
    grouping = _categories(train)
    return {
        TEXT: {"columns": free, "categories": categories, "empty": empty},
        DATES: {"columns": dates},
        CATEGORIES: grouping,
        GAPS: _gaps(train),
        ENCODING: _encoding(train, grouping["grouped"]),
        **_spread(train),
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


def _encoding(train: pl.DataFrame, grouped: list[str]) -> dict[str, list[str]]:
    """Categories one-hot takes, those too wide for it, and whole numbers that may be codes.
    A `grouped` column keeps at most MAX_CATEGORIES once rare values are grouped, so one-hot
    takes it."""
    distinct = _distinct(train)
    categories = [n for n, kind in train.schema.items() if isinstance(kind, CATEGORY_TYPES)]
    codes = [
        n
        for n, kind in train.schema.items()
        if kind.is_integer() and MIN_CODE_VALUES <= distinct[n] <= MAX_CATEGORIES
    ]
    return {
        "few": [n for n in categories if distinct[n] <= MAX_CATEGORIES or n in grouped],
        "many": [n for n in categories if distinct[n] > MAX_CATEGORIES and n not in grouped],
        "codes": codes,
    }


def _spread(train: pl.DataFrame) -> dict[str, Any]:
    """Numbers skewed enough for a power transform, and numbers to scale, with whether any
    has heavy tails. A 0/1 column has no tail to fix, so it is neither. Scaling comes after
    the transform, which takes most of a skewed tail away, so only the tails of numbers it
    leaves alone count."""
    shapes = {
        n: shape(train[n])
        for n, kind in train.schema.items()
        if kind.is_numeric() and train[n].drop_nulls().n_unique() > 2
    }
    skewed = [n for n, s in shapes.items() if abs(s.get("skewness", 0.0)) > SKEW_TRANSFORM]
    spread = {n: s for n, s in shapes.items() if s.get("iqr")}
    heavy = any(
        s.get("kurtosis", 0.0) > HEAVY_KURTOSIS
        or s.get("outlier_share", 0.0) >= HEAVY_OUTLIER_SHARE
        for n, s in spread.items()
        if n not in skewed
    )
    return {SKEW: {"columns": skewed}, SCALING: {"columns": list(spread), "heavy": heavy}}
