from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/skew_transform"
SETTINGS = {"skewness_threshold": 1.0}


def run(profile: dict[str, object]) -> dict[str, Any]:
    return decide(RULE, profile={"rows": 750, **profile}, settings=SETTINGS)


def test_a_skewed_number_is_power_transformed_before_a_linear_model() -> None:
    d = run(
        {
            **column("income", "Float64", distinct=700, skewness=3.2),
            **column("debt", "Float64", distinct=600, skewness=-1.4),
            **column("age", "Int64", distinct=53, skewness=0.4),
        }
    )
    assert d["recommended_alternative_id"] == "yeo_johnson"
    assert alternative(d, "yeo_johnson")["params"] == {"columns": ["debt", "income"]}
    assert {
        "kind": "profile_fact",
        "label": "income skewness",
        "value": "3.2",
        "origin": "measured",
    } in d["evidence"]


def test_numbers_close_to_symmetric_are_left_as_they_are() -> None:
    d = run(column("age", "Int64", distinct=53, skewness=0.4))
    assert d["recommended_alternative_id"] == "no_transform"
    assert alternative(d, "yeo_johnson")["applicability"] == "not_applicable"
    assert alternative(d, "no_transform")["applicability"] == "applicable"


def test_a_0_1_column_is_not_transformed_however_skewed() -> None:
    d = run(column("purpose_car", "Int8", distinct=2, skewness=4.0))
    assert d["recommended_alternative_id"] == "no_transform"


def test_a_column_with_no_measured_skewness_and_text_are_left_alone() -> None:
    d = run({**column("flat", "Float64", distinct=1), **column("purpose", "String", distinct=10)})
    assert d["recommended_alternative_id"] == "no_transform"
