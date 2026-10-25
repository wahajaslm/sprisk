"""Which text columns hold numbers (ADR-0063 slice 6): the evidence the missing markers and
wrong types methods decide on. Every row, before the split; it reads text structure, never
the label's values."""

import re
from typing import Any

import polars as pl

from .dataset import conversion

MARKERS = "data.missing_markers"
NUMBERS = "data.number_text"
# A text column holds numbers when at least this share of its present values reads as one.
# Kept low because placeholders count against it: 10% "?" is common (UCI hepatitis).
MIN_NUMERIC_SHARE = 0.5
# Placeholders are few and repeated; more values that are not numbers mean broken data.
MAX_MARKER_VALUES = 5
# Marked without asking: common placeholders with no other meaning. "NA" is left out on
# purpose: it is also a country code.
KNOWN_MARKERS = frozenset(
    {"?", "-", "--", ".", "", "n/a", "N/A", "null", "NULL", "None", "NaN", "nan", "missing"}
    | {"unknown"}
)
COMMA_NUMBER = re.compile(r"^\s*[+-]?\d[\d,]*(\.\d+)?\s*$")


def number_text(data: pl.DataFrame, target: str | None = None) -> dict[str, Any]:
    """Placeholders to mark missing, values that may be real and are only named, and the text
    columns to read as numbers: as they are, or once their placeholders are marked. `target`
    only names the column the worker drops before this runs."""
    marked: list[str] = []
    values: set[str] = set()
    unknown: list[str] = []
    numbers: list[str] = []
    once_marked: list[str] = []
    codes: list[str] = []
    comma: list[str] = []
    for name, kind in data.schema.items():
        if kind != pl.String:
            continue
        found = conversion(data[name])
        if found.get("numeric_share", 0.0) < MIN_NUMERIC_SHARE:
            continue
        if found["leading_zero_values"]:
            codes.append(name)
            continue
        left: list[str] = found.get("unconverted", [])
        if not left:
            numbers.append(name)
            once_marked.append(name)
            continue
        if all(COMMA_NUMBER.match(v) for v in left):
            comma.append(f"{name}: {_shown(left)}")
            continue
        if len(left) > MAX_MARKER_VALUES:
            continue
        # Matched without spaces, given as written: mark_missing matches whole values.
        known = [v for v in left if v.strip() in KNOWN_MARKERS]
        other = [v for v in left if v.strip() not in KNOWN_MARKERS]
        if known:
            marked.append(name)
            values.update(known)
        if other:
            unknown.append(f"{name}: {_shown(other)}")
        else:
            once_marked.append(name)
    return {
        MARKERS: {"columns": marked, "values": sorted(values), "unknown": unknown},
        NUMBERS: {
            "numbers": numbers,
            "numbers_once_marked": once_marked,
            "codes": codes,
            "comma_numbers": comma,
        },
    }


def _shown(values: list[str]) -> str:
    return ", ".join(repr(v) for v in values)
