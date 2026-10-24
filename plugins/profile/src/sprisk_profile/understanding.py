"""What a profile says about a table for people (ADR-0065): the role each column's values
suggest, and what stands out, as plain sentences with one example from the data. Descriptive
only: a role is a suggestion and a finding is never evidence for a decision."""

from typing import Any

import polars as pl

# Integer columns with at most this many distinct values read as codes for categories (a
# class label such as 2583); more read as measured numbers.
MAX_CATEGORY_CODES = 30
# Text whose values mostly hold several words is free text, as the column-roles rule reads it.
FREE_TEXT_WORD_SHARE = 0.5
# Missing in this share of rows or more is a warning: it changes how the column is prepared.
MISSING_WARNING = 0.2
# A category whose most common value is this many times its rarest is uneven.
UNEVEN = 10
MAX_UNEVEN_VALUES = 50
OUTLIER_NOTE = 0.01
STRONG_SKEW = 2.0
MAX_FINDINGS = 60
# Examples are dataset text (untrusted, rule 7): shown as text, cut short.
MAX_EXAMPLE = 120


def role(s: pl.Series, word_share: float | None) -> str:
    """A guess from the values alone. An integer or a word in every row, each different, names
    rows; several words per value are text; few distinct values are a category."""
    present = s.drop_nulls()
    if present.is_empty():
        return "empty"
    distinct = present.n_unique()
    if distinct == 1:
        return "constant"
    if s.dtype == pl.Boolean:
        return "boolean"
    if s.dtype.is_temporal():
        return "time"
    if s.dtype.is_integer():
        unique = distinct == present.len()
        if unique and distinct > MAX_CATEGORY_CODES:
            return "identifier"
        # A code names a category only when rows share it.
        return "category" if distinct <= MAX_CATEGORY_CODES and not unique else "number"
    if s.dtype.is_numeric():
        return "number"
    if s.dtype == pl.String:
        if (word_share or 0.0) >= FREE_TEXT_WORD_SHARE:
            return "text"
        return "identifier" if distinct == present.len() else "category"
    return "category"


def findings(
    data: pl.DataFrame, columns: list[dict[str, Any]], duplicates: int | None
) -> list[dict[str, Any]]:
    """Warnings first, then notes; the table's own before its columns', columns in order."""
    rows = data.height
    found: list[dict[str, Any]] = []
    if duplicates:
        found.append(
            _finding(
                "warning",
                "duplicates",
                None,
                f"{duplicates:,} of {rows:,} rows are identical in every column to an earlier row.",
            )
        )
    for column in columns:
        found.extend(_about(data[column["name"]], column, rows))
    found.sort(key=lambda f: f["level"] != "warning")
    return found[:MAX_FINDINGS]


def _about(s: pl.Series, column: dict[str, Any], rows: int) -> list[dict[str, Any]]:
    name, kind = column["name"], column.get("role")
    out: list[dict[str, Any]] = []
    if missing := column["missing"]:
        level = "warning" if missing / rows >= MISSING_WARNING else "note"
        out.append(
            _finding(
                level,
                "missing",
                name,
                f"{name} is missing in {missing:,} of {rows:,} rows ({_pct(missing / rows)}).",
            )
        )
    if blank := column.get("blank"):
        out.append(
            _finding(
                "warning",
                "blank",
                name,
                f"{name} holds blank text in {blank:,} of {rows:,} rows ({_pct(blank / rows)}): "
                "empty, not missing, so an imputer will not see it.",
            )
        )
    present = s.drop_nulls()
    if kind == "identifier":
        out.append(
            _finding(
                "note",
                "identifier",
                name,
                f"{name} has a different value in every row: it names rows rather than "
                "describing them.",
                present[0],
            )
        )
    if kind == "constant":
        out.append(
            _finding(
                "note",
                "constant",
                name,
                f"{name} holds one value wherever it is filled: it cannot tell rows apart.",
                present[0],
            )
        )
    if kind == "text":
        out.extend(_repeated(present, name))
    if kind in ("category", "boolean"):
        out.extend(_uneven(present, name))
    if html := column.get("html_share"):
        out.append(
            _finding(
                "warning",
                "html",
                name,
                f"{_pct(html)} of {name} values hold HTML tags or entities, which a word count "
                "would read as words.",
            )
        )
    variants = column.get("case_variants", 0) + column.get("accent_variants", 0)
    if variants:
        out.append(
            _finding(
                "note",
                "spelling",
                name,
                f"{variants:,} distinct values of {name} differ from another only in spaces, "
                "case or accents.",
            )
        )
    share = column.get("numeric_share")
    if share is not None and 0.5 <= share < 1.0 and column.get("unconverted"):
        out.append(
            _finding(
                "warning",
                "not_numbers",
                name,
                f"{_pct(share)} of {name} values read as numbers; the rest do not, such as "
                "this one.",
                column["unconverted"][0],
            )
        )
    if kind == "number":
        if (outliers := column.get("outlier_share", 0.0)) >= OUTLIER_NOTE:
            out.append(
                _finding(
                    "note",
                    "outliers",
                    name,
                    f"{_pct(outliers)} of {name} values lie outside the 1.5 × IQR fences.",
                )
            )
        if abs(skew := column.get("skewness", 0.0)) >= STRONG_SKEW:
            side = "a few are very large" if skew > 0 else "a few are very small"
            out.append(
                _finding(
                    "note",
                    "skew",
                    name,
                    f"{name} is strongly skewed (skewness {skew:.1f}): most values sit together "
                    f"and {side}.",
                )
            )
    return out


def _repeated(present: pl.Series, name: str) -> list[dict[str, Any]]:
    """Text that several rows share, such as one title listed twice."""
    # Fixed names: the column's own name could be "count" (rule 7).
    counts = present.rename("value").value_counts(name="n").filter(pl.col("n") > 1)
    if counts.is_empty():
        return []
    top = counts.sort(["n", "value"], descending=[True, False]).row(0)
    return [
        _finding(
            "note",
            "repeated_values",
            name,
            f"{int(counts['n'].sum()):,} of {present.len():,} rows of {name} share their value "
            f"with another row; the most repeated value appears {top[1]:,} times.",
            top[0],
        )
    ]


def _uneven(present: pl.Series, name: str) -> list[dict[str, Any]]:
    """A category whose classes differ a lot in size, such as a rare class of a target."""
    counts = present.cast(pl.String).rename("value").value_counts(name="n")
    if not 2 <= counts.height <= MAX_UNEVEN_VALUES:
        return []
    ordered = counts.sort(["n", "value"], descending=[True, False])
    (most, most_n), (rarest, rarest_n) = ordered.row(0), ordered.row(-1)
    if most_n < UNEVEN * rarest_n:
        return []
    total = present.len()
    return [
        _finding(
            "note",
            "imbalance",
            name,
            f"{name} is uneven: its most common value, {_cut(most)}, holds "
            f"{_pct(most_n / total)} of rows; its rarest, {_cut(rarest)}, holds "
            f"{_pct(rarest_n / total)}.",
        )
    ]


def _finding(
    level: str, topic: str, column: str | None, text: str, example: Any = None
) -> dict[str, Any]:
    found: dict[str, Any] = {"level": level, "topic": topic, "text": text}
    if column is not None:
        found["column"] = column
    if example is not None:
        found["example"] = _cut(example)
    return found


def _cut(value: Any) -> str:
    return str(value)[:MAX_EXAMPLE]


def _pct(share: float) -> str:
    return "<1%" if 0 < share < 0.01 else f"{round(share * 100)}%"
