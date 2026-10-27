"""What a profile says about a table for people (ADR-0065): each column's role, blanks apart
from gaps, words per text value, the five-number summary, a long-tailed value distribution,
and findings in plain sentences with an example."""

import json
from datetime import date

import polars as pl

from sprisk_contracts import DatasetProfile
from sprisk_contracts.generated.models import ColumnProfile, ProfileFinding
from sprisk_profile.dataset import TOP_VALUES
from sprisk_profile.dataset import profile as raw_profile


def profile(data: pl.DataFrame) -> DatasetProfile:
    return DatasetProfile.model_validate_json(
        json.dumps(raw_profile(data, data.height), allow_nan=False)
    )


def column(p: DatasetProfile, name: str) -> ColumnProfile:
    return next(c for c in p.columns if c.name == name)


def listings(n: int = 100) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "row": list(range(n)),
            "sku": [f"SKU{i:05d}" for i in range(n)],
            "title": [f"Lampe de chevet {i % 40}" for i in range(n)],
            "colour": ["noir" if i % 10 else "blanc" for i in range(n)],
            "price": [float(i % 50) + 0.5 for i in range(n)],
            "shop": ["one"] * n,
            "gone": pl.Series([None] * n, dtype=pl.String),
            "listed": [date(2026, 1, 1 + i % 28) for i in range(n)],
            "boxed": [i % 2 == 0 for i in range(n)],
            "code": [i % 5 for i in range(n)],
        }
    )


def test_each_column_gets_the_role_its_values_suggest() -> None:
    p = profile(listings())
    roles = {c.name: c.role for c in p.columns}
    assert roles == {
        "row": "identifier",
        "sku": "identifier",
        "title": "text",
        "colour": "category",
        "price": "number",
        "shop": "constant",
        "gone": "empty",
        "listed": "time",
        "boxed": "boolean",
        "code": "category",
    }


def test_blank_text_is_counted_apart_from_missing_cells() -> None:
    p = profile(pl.DataFrame({"description": ["", "  ", "Une lampe", None]}))
    described = column(p, "description")
    assert (described.missing, described.blank) == (1, 2)


def test_text_columns_count_words_per_value() -> None:
    p = profile(pl.DataFrame({"title": ["a b", "a b c", "a", "a b c d"] * 5}))
    words = column(p, "title").word_counts
    assert words is not None and words.kind == "bins"
    assert sum(b.count for b in words.bars) == 20


def test_numbers_get_their_five_number_summary() -> None:
    p = profile(pl.DataFrame({"price": [1.0, 2.0, 3.0, 4.0, 5.0]}))
    q = column(p, "price").quartiles
    assert q is not None and (q.min, q.q1, q.median, q.q3, q.max) == (1.0, 2.0, 3.0, 4.0, 5.0)


def test_a_category_shows_its_most_common_values_and_counts_the_long_tail() -> None:
    values = [f"c{i}" for i in range(TOP_VALUES + 5) for _ in range(TOP_VALUES + 5 - i)]
    histogram = column(profile(pl.DataFrame({"kind": values})), "kind").histogram
    assert histogram is not None and len(histogram.bars) == TOP_VALUES
    assert histogram.other == sum(range(1, 6))


def finding(p: DatasetProfile, topic: str, name: str | None = None) -> ProfileFinding:
    return next(f for f in p.findings or [] if f.topic == topic and f.column == name)


def test_missing_and_blank_values_are_warned_about_with_their_counts() -> None:
    p = profile(pl.DataFrame({"description": ["", "", "Une lampe", None] * 25}))
    assert (
        finding(p, "missing", "description").text
        == "description is missing in 25 of 100 rows (25%)."
    )
    blank = finding(p, "blank", "description")
    assert blank.level == "warning"
    assert (
        blank.text == "description holds blank text in 50 of 100 rows (50%): "
        "empty, not missing, so an imputer will not see it."
    )


def test_an_identifier_is_named_with_an_example() -> None:
    p = profile(listings())
    found = finding(p, "identifier", "sku")
    assert (
        found.text
        == "sku has a different value in every row: it names rows rather than describing them."
    )
    assert found.example == "SKU00000"


def test_repeated_text_names_its_most_repeated_value() -> None:
    p = profile(listings())
    found = finding(p, "repeated_values", "title")
    assert (
        found.text == "100 of 100 rows of title share their value with another row; "
        "the most repeated value appears 3 times."
    )
    assert found.example == "Lampe de chevet 0"


def test_a_skewed_class_distribution_names_its_largest_and_rarest_class() -> None:
    p = profile(pl.DataFrame({"label": ["a"] * 90 + ["b"] * 9 + ["c"]}))
    assert (
        finding(p, "imbalance", "label").text
        == "label is uneven: its most common value, a, holds 90% of rows; its rarest, c, holds 1%."
    )


def test_whole_table_findings_come_first_by_level_then_by_column_order() -> None:
    data = listings().with_columns(pl.lit(None, dtype=pl.String).alias("note"))
    p = profile(pl.concat([data, data.head(3)]))
    levels = [f.level for f in p.findings or []]
    assert levels == sorted(levels, key=lambda level: level != "warning")
    assert (
        finding(p, "duplicates").text
        == "3 of 103 rows are identical in every column to an earlier row."
    )


def test_identifiers_are_left_out_of_the_correlation_field() -> None:
    p = profile(listings())
    assert "row" not in p.correlation.columns
    assert "code" not in p.correlation.columns


def test_few_integers_that_never_repeat_are_numbers_not_category_codes() -> None:
    p = profile(pl.DataFrame({"x": [1, 2], "y": [3, 5]}))
    assert [c.role for c in p.columns] == ["number", "number"]
