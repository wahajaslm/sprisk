import re
from html import unescape
from html.entities import html5

import polars as pl

# The profile's html_share counts values matching TAG or ENTITY (sprisk_profile.dataset.HTML);
# a step may not import another package (ADR-0022), so the pattern is repeated, and only values
# it matches are changed. A tag starts with a letter after "<", so "5 < 7" and "10<x cm" stay;
# an entity ends in ";", so "AT&T" and "&copy2020" stay.
TAG = r"<!--(?s:.*?)-->|</?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?/?>"
ENTITY = r"&(#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);"
MARKUP = re.compile(f"{TAG}|{ENTITY}")
# Their content is code, not text.
HIDDEN = re.compile(r"<(script|style)\b[^>]*>.*?</(script|style)\s*>", re.IGNORECASE | re.DOTALL)


def _entity(match: re.Match[str]) -> str:
    # unescape alone decodes the longest known prefix, so "&copyright;" would become "©right;".
    ref = match[0]
    return unescape(ref) if ref.startswith("&#") or ref[1:] in html5 else ref


def _text(value: str) -> str:
    if not MARKUP.search(value):
        return value
    text = re.sub(TAG, " ", HIDDEN.sub(" ", value))
    text = re.sub(ENTITY, _entity, text)
    # A tag becomes a space so "2<br />neuf" stays two words; runs of spaces become one.
    return " ".join(text.split())


def strip_html(data: pl.DataFrame, columns: list[str]) -> pl.DataFrame:
    """In values holding markup, tags become spaces and entities their characters; script and
    style content goes. Other values are left exactly as they are."""
    stripped = []
    for c in columns:
        dtype = data.schema.get(c)
        if dtype is None:
            raise pl.exceptions.ColumnNotFoundError(c)
        if dtype != pl.String:
            raise ValueError(f"{c} is not a text column ({dtype})")
        # A series, never pl.col(c): a column name (untrusted, rule 7) may look like a pattern.
        stripped.append(data[c].map_elements(_text, return_dtype=pl.String))
    return data.with_columns(stripped)
