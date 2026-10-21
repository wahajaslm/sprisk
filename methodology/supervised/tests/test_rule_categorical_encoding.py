from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/categorical_encoding"
SETTINGS = {"high_cardinality_threshold": 15}


def run(profile: dict[str, object]) -> dict[str, Any]:
    return decide(RULE, profile={"rows": 750, **profile}, settings=SETTINGS)


def test_text_with_few_categories_is_one_hot_encoded_before_the_model() -> None:
    d = run(
        {
            **column("purpose", "String", distinct=10),
            **column("housing", "String", distinct=3),
            **column("age", "Int64", distinct=53),
        }
    )
    assert d["recommended_alternative_id"] == "one_hot_encoding"
    assert alternative(d, "one_hot_encoding")["params"] == {"columns": ["housing", "purpose"]}
    assert {
        "kind": "profile_fact",
        "label": "purpose categories",
        "value": "10",
        "origin": "measured",
    } in d["evidence"]


def test_true_false_and_category_columns_are_encoded_too() -> None:
    d = run(
        {**column("owns_home", "Boolean", distinct=2), **column("tier", "Categorical", distinct=4)}
    )
    assert alternative(d, "one_hot_encoding")["params"] == {"columns": ["owns_home", "tier"]}


def test_text_with_many_categories_is_named_and_left_out() -> None:
    d = run(
        {**column("purpose", "String", distinct=10), **column("title", "String", distinct=8000)}
    )
    one_hot = alternative(d, "one_hot_encoding")
    assert one_hot["params"] == {"columns": ["purpose"]}
    assert "title (8000 categories)" in one_hot["reason"]


def test_only_text_with_many_categories_gets_no_one_hot_and_says_what_is_missing() -> None:
    d = run(column("title", "String", distinct=8000))
    assert alternative(d, "one_hot_encoding")["applicability"] == "not_applicable"
    none = alternative(d, "no_encoding")
    assert none["applicability"] == "not_applicable"
    assert "title" in none["reason"]
    assert d["recommended_alternative_id"] == "no_encoding"


def test_numbers_alone_need_no_encoding() -> None:
    d = run({**column("age", "Int64", distinct=53), **column("amount", "Float64", distinct=900)})
    assert d["recommended_alternative_id"] == "no_encoding"
    assert alternative(d, "no_encoding")["applicability"] == "applicable"
    assert alternative(d, "one_hot_encoding")["applicability"] == "not_applicable"


def test_a_date_is_not_a_category_to_encode() -> None:
    d = run({**column("opened", "Date", distinct=3), **column("purpose", "String", distinct=10)})
    assert alternative(d, "one_hot_encoding")["params"] == {"columns": ["purpose"]}


def test_target_and_ordinal_encoding_are_never_offered_as_applicable() -> None:
    d = run(column("purpose", "String", distinct=10))
    assert "leaks" in alternative(d, "target_encoding_oof")["reason"]
    assert "order" in alternative(d, "ordinal_encoding")["reason"]
    for id in ("target_encoding_oof", "ordinal_encoding"):
        assert alternative(d, id)["applicability"] == "not_applicable", id
