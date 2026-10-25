"""Which columns only name rows, and which rows copy an earlier one (ADR-0063 slice 6): the
evidence the column roles and exact duplicates methods decide on. Every row, before the
split; it reads structure, never the label's values."""

from typing import Any

import polars as pl

from .dataset import words

IDS = "data.identifiers"
DUPLICATES = "data.duplicate_rows"
# Share of values holding more than one word up to which text is a code, not free text.
# Tolerates a few stray spaces in codes.
MAX_WORD_SHARE = 0.05


def column_roles(
    data: pl.DataFrame,
    target: str | None = None,
    item: str | None = None,
    time: str | None = None,
) -> dict[str, Any]:
    """Identifiers: whole-number or one-word text columns with a different value in every
    row, which name a row and carry no pattern. All-unique decimals are measurements and
    all-unique multi-word text is free text. The item and time columns are never identifiers;
    the target is dropped before this runs. Copies are rows equal to an earlier one in every
    column but the identifiers: a row loaded twice under two row ids is still one row."""
    # The worker drops the target before this runs; `target` only names it.
    held = {c for c in (item, time) if c is not None}
    rows = data.height
    # A copied row repeats its identifier too, so it does not make the identifier less unique.
    distinct_rows = data.n_unique() if rows else 0
    ids = [
        name
        for name in data.columns
        if name not in held and rows and _names_rows(data[name], distinct_rows)
    ]
    keep = [c for c in data.columns if c not in ids]
    copies = rows - data.select(data[c] for c in keep).n_unique() if rows and keep else 0
    return {
        IDS: {
            "columns": ids,
            "rows": rows,
            "features_left": len([c for c in keep if c not in held]),
        },
        DUPLICATES: {"rows": rows, "duplicates": copies},
    }


def _names_rows(s: pl.Series, distinct_rows: int) -> bool:
    if s.drop_nulls().n_unique() < distinct_rows:
        return False
    if s.dtype.is_integer():
        return True
    return s.dtype == pl.String and words(s).get("word_share", 0.0) <= MAX_WORD_SHARE
