from typing import Any

import pytest
from rule_harness import alternative, column, decide, manifest

from sprisk_workers.errors import RuleError

RULE = "supervised/rare_categories"
SETTINGS = {"high_cardinality_threshold": 15, "min_share": 0.01, "identifier_share": 0.5}


def run(profile: dict[str, object], rows: int = 750) -> dict[str, Any]:
    return decide(RULE, profile={"rows": rows, **profile}, settings=SETTINGS)


def test_text_with_many_categories_keeps_few_enough_for_one_hot_before_the_model() -> None:
    d = run(
        {
            **column("city", "String", distinct=120),
            **column("purpose", "String", distinct=10),
            **column("age", "Int64", distinct=53),
        }
    )
    assert d["recommended_alternative_id"] == "group_rare"
    assert alternative(d, "group_rare")["params"] == {
        "columns": ["city"],
        "min_share": 0.01,
        "max_categories": 15,
    }
    assert {
        "kind": "profile_fact",
        "label": "city categories",
        "value": "120",
        "origin": "measured",
    } in d["evidence"]


def test_few_categories_are_left_for_one_hot_encoding() -> None:
    d = run(column("purpose", "String", distinct=10))
    assert d["recommended_alternative_id"] == "keep_categories"
    assert alternative(d, "group_rare")["applicability"] == "not_applicable"
    assert alternative(d, "keep_categories")["applicability"] == "applicable"


def test_a_column_with_a_value_for_most_rows_is_an_identifier_and_is_named_not_grouped() -> None:
    d = run(
        {**column("customer", "String", distinct=400), **column("city", "Categorical", distinct=40)}
    )
    group = alternative(d, "group_rare")
    assert group["params"]["columns"] == ["city"]
    assert "customer" in group["reason"]


def test_only_an_identifier_groups_nothing_and_says_why() -> None:
    d = run(column("customer", "String", distinct=750))
    assert d["recommended_alternative_id"] == "keep_categories"
    assert "customer" in alternative(d, "group_rare")["reason"]


def test_numbers_and_dates_are_not_categories() -> None:
    d = run({**column("amount", "Float64", distinct=700), **column("opened", "Date", distinct=300)})
    assert d["recommended_alternative_id"] == "keep_categories"


def test_an_unmeasured_category_count_is_an_error_not_zero() -> None:
    with pytest.raises(RuleError, match="distinct"):
        run(column("city", "String"))


def test_the_limit_is_the_one_categorical_encoding_one_hot_encodes_up_to() -> None:
    # Grouping keeps at most this many, so encoding then takes the column.
    encoding = manifest("supervised/categorical_encoding")["policy_thresholds"]
    ours = manifest(RULE)["policy_thresholds"]
    assert ours["high_cardinality_threshold"] == encoding["high_cardinality_threshold"]
