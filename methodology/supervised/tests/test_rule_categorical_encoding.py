from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/categorical_encoding"
SETTINGS = {"high_cardinality_threshold": 15}


def run(
    profile: dict[str, object], facts: dict[str, tuple[str, str]] | None = None
) -> dict[str, Any]:
    return decide(RULE, facts=facts, profile={"rows": 750, **profile}, settings=SETTINGS)


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


def test_text_with_many_categories_is_named_in_the_one_hot_reason() -> None:
    d = run(
        {**column("purpose", "String", distinct=10), **column("title", "String", distinct=8000)}
    )
    one_hot = alternative(d, "one_hot_encoding")
    assert one_hot["params"] == {"columns": ["purpose"]}
    assert "title (8000 categories)" in one_hot["reason"]


def test_text_with_many_categories_alone_is_left_out_of_the_model() -> None:
    d = run(column("title", "String", distinct=8000))
    assert d["recommended_alternative_id"] == "leave_out_columns"
    leave_out = alternative(d, "leave_out_columns")
    assert leave_out["applicability"] == "applicable"
    assert leave_out["params"] == {"exclude": ["title"]}
    assert "title (8000 categories)" in leave_out["reason"]
    assert alternative(d, "no_encoding")["applicability"] == "not_applicable"


def test_leaving_out_keeps_the_columns_the_model_already_leaves_out() -> None:
    d = run(column("title", "String", distinct=8000), {"step.exclude": ("user, id", "explicit")})
    assert alternative(d, "leave_out_columns")["params"] == {"exclude": ["id", "title", "user"]}


def test_a_model_that_lists_its_features_is_told_to_drop_the_column_from_them() -> None:
    facts = {"step.features": ("age, title", "explicit")}
    d = run({**column("title", "String", distinct=8000)}, facts)
    leave_out = alternative(d, "leave_out_columns")
    assert leave_out["applicability"] == "not_applicable"
    assert "remove title from them" in leave_out["reason"]


def test_few_and_many_categories_one_hot_the_few_and_can_leave_out_the_many() -> None:
    d = run(
        {**column("purpose", "String", distinct=10), **column("title", "String", distinct=8000)}
    )
    assert d["recommended_alternative_id"] == "one_hot_encoding"
    assert alternative(d, "leave_out_columns")["params"] == {"exclude": ["title"]}


def test_whole_numbers_with_few_values_may_be_categories_so_the_rule_asks() -> None:
    d = run(
        {
            **column("installment_rate", "Int64", distinct=4),
            **column("dependents", "Int64", distinct=2),
            **column("age", "Int64", distinct=53),
        }
    )
    codes = alternative(d, "one_hot_integer_codes")
    assert codes["applicability"] == "needs_fact"
    assert "installment_rate (4 values)" in codes["reason"]
    assert "dependents" not in codes["reason"] and "age" not in codes["reason"]
    # Until the question is answered, reading them as amounts is not a safe default either.
    assert d["recommended_alternative_id"] == "no_encoding"
    none = alternative(d, "no_encoding")
    assert none["applicability"] == "needs_fact"
    assert "installment_rate" in none["reason"]


def test_one_hot_before_least_squares_says_its_coefficients_must_not_be_read() -> None:
    least_squares = {
        "flow.model_families": ("linear", "measured"),
        "step.task": ("regression", "explicit"),
    }
    d = run(column("purpose", "String", distinct=10), least_squares)
    assert "coefficients" in alternative(d, "one_hot_encoding")["reason"]
    logistic = {**least_squares, "step.task": ("classification", "explicit")}
    d = run(column("purpose", "String", distinct=10), logistic)
    assert "coefficients" not in alternative(d, "one_hot_encoding")["reason"]


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
