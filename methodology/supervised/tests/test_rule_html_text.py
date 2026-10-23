from typing import Any

import pytest
from rule_harness import alternative, decide

from sprisk_workers.errors import RuleError

RULE = "common/html_text"
TARGET = {"question.target": ("prdtypecode", "confirmed")}


def text(name: str, html: float | None, distinct: int = 400) -> dict[str, Any]:
    measures: dict[str, Any] = {
        f"input.column.{name}.data_type": "String",
        f"input.column.{name}.distinct": distinct,
    }
    if html is not None:
        measures[f"input.column.{name}.html_share"] = html
    return measures


def run(profile: dict[str, Any], facts: dict[str, tuple[str, str]] | None = None) -> dict[str, Any]:
    return decide(RULE, facts={**TARGET, **(facts or {})}, profile=profile)


def test_text_columns_holding_html_are_stripped_before_the_split() -> None:
    d = run({**text("description", 0.4), **text("designation", 0.01), **text("city", 0.0)})
    assert d["recommended_alternative_id"] == "strip"
    assert alternative(d, "strip")["params"] == {"columns": ["description", "designation"]}
    # Keeping the markup stays on offer: a person may know it is not HTML.
    assert alternative(d, "keep")["applicability"] == "applicable"


def test_text_without_html_is_kept() -> None:
    d = run({**text("city", 0.0), "input.column.n.data_type": "Int64"})
    assert d["recommended_alternative_id"] == "keep"
    assert alternative(d, "strip")["applicability"] == "not_applicable"


def test_the_target_and_the_unit_and_time_columns_are_never_stripped() -> None:
    facts = {
        "question.entity_column": ("seller", "confirmed"),
        # An inferred column is held too: leaving a column as it is needs no confirmation.
        "question.time_column": ("listed", "inferred"),
    }
    d = run(
        {
            **text("prdtypecode", 0.2),
            **text("seller", 0.5),
            **text("listed", 0.5),
            **text("description", 0.4),
        },
        facts,
    )
    assert alternative(d, "strip")["params"]["columns"] == ["description"]
    reason = alternative(d, "strip")["reason"]
    for name in ("prdtypecode", "seller", "listed"):
        assert name in reason


def test_only_held_columns_with_html_keep_and_say_so_without_asking() -> None:
    d = run(text("prdtypecode", 0.2))
    keep = alternative(d, "keep")
    assert d["recommended_alternative_id"] == "keep"
    assert keep["applicability"] == "applicable" and "prdtypecode" in keep["reason"]


def test_a_text_column_with_no_values_needs_no_html_share() -> None:
    d = run(text("blank", None, distinct=0))
    assert d["recommended_alternative_id"] == "keep"


def test_an_unmeasured_html_share_is_an_error_not_zero() -> None:
    with pytest.raises(RuleError, match="html_share"):
        run(text("description", None))


def test_a_guessed_target_is_held_too() -> None:
    d = decide(
        RULE,
        facts={"question.target": ("description", "inferred")},
        profile=text("description", 0.4),
    )
    assert d["recommended_alternative_id"] == "keep"


def test_text_that_is_not_a_string_column_is_not_measured() -> None:
    d = run({"input.column.code.data_type": "Categorical", "input.column.code.distinct": 40})
    assert d["recommended_alternative_id"] == "keep"
