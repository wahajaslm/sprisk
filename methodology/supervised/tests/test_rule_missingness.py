from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/missingness"
SETTINGS = {
    "drop_column_threshold": 0.6,
    "indicator_flag_threshold": 0.2,
    "skewness_threshold": 1.5,
}
TARGET = {"question.target": ("churned", "explicit")}


def run(profile: dict[str, object]) -> dict[str, Any]:
    return decide(RULE, facts=TARGET, profile={"rows": 100, **profile}, settings=SETTINGS)


def test_skewed_numbers_are_filled_with_the_train_median() -> None:
    d = run(
        {**column("income", missing_share=0.1, skewness=2.4), **column("age", missing_share=0.05)}
    )
    assert d["recommended_alternative_id"] == "impute_median"
    assert alternative(d, "impute_median")["params"] == {
        "columns": ["age", "income"],
        "method": "median",
    }


def test_symmetric_numbers_are_filled_with_the_train_mean() -> None:
    d = run(column("age", missing_share=0.1, skewness=0.2))
    assert d["recommended_alternative_id"] == "impute_mean"


def test_a_target_with_gaps_is_never_filled() -> None:
    d = run(column("churned", "Int64", missing_share=0.1, skewness=0.1))
    assert d["recommended_alternative_id"] == "drop_rows"
    assert alternative(d, "impute_mean")["applicability"] == "not_applicable"
    assert alternative(d, "drop_rows")["params"] == {"columns": ["churned"]}


def test_text_columns_cannot_be_imputed_yet() -> None:
    d = run(column("city", "String", missing_share=0.1))
    assert d["recommended_alternative_id"] == "drop_rows"
    assert "numbers only" in alternative(d, "impute_median")["reason"]


def test_a_mostly_empty_column_is_named_in_the_drop_column_reason() -> None:
    d = run(column("notes", missing_share=0.84, skewness=0.0))
    assert "notes" in alternative(d, "drop_column")["reason"]
    assert alternative(d, "drop_column")["applicability"] == "not_applicable"


def test_measured_missing_shares_are_evidence() -> None:
    d = run(column("age", missing_share=0.1))
    assert {
        "kind": "profile_fact",
        "label": "age missing share",
        "value": "10.0%",
        "origin": "measured",
    } in d["evidence"]
