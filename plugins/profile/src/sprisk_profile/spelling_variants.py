"""Which category text is typed several ways (ADR-0063 slice 6): the evidence the text
spelling method decides on. Every row, before the split; it reads text structure, never
the label's values."""

from typing import Any

import polars as pl

from .dataset import spelling, words

KIND = "data.spelling_variants"
# Free text when most values hold several words: word features read it without case, so its
# spelling is the text steps' to handle. The text representation rule's free_text_word_share.
FREE_TEXT_WORD_SHARE = 0.5
# An identifier when there are at least half as many distinct values as rows: lowercasing it
# could merge two entities. The same convention as the old rule's identifier_share.
IDENTIFIER_SHARE = 0.5


def spelling_variants(data: pl.DataFrame) -> dict[str, Any]:
    """The category columns whose values differ only in spaces or case, to merge; identifier
    columns that do, named but never merged; and columns whose values differ only in accents,
    named but not merged, since 'año' and 'ano' differ."""
    columns: list[str] = []
    identifier_like: list[str] = []
    accent_only: list[str] = []
    texts = [name for name, kind in data.schema.items() if kind == pl.String]
    for name in texts:
        values = data[name]
        if words(values).get("word_share", 0.0) >= FREE_TEXT_WORD_SHARE:
            continue
        variants = spelling(values)
        if variants["accent_variants"]:
            accent_only.append(name)
        if not variants["case_variants"]:
            continue
        if values.drop_nulls().n_unique() >= IDENTIFIER_SHARE * data.height:
            identifier_like.append(name)
        else:
            columns.append(name)
    return {
        KIND: {
            "columns": columns,
            "identifier_like": identifier_like,
            "accent_only": accent_only,
            "text_columns": len(texts),
        }
    }
