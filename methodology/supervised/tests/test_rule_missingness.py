from typing import Any

import pytest
from rule_harness import CLUSTERING, FOREST, LINEAR, alternative, column, decide, flow

from sprisk_workers.errors import RuleError

RULE = "supervised/missingness"
SETTINGS = {
    "drop_column_threshold": 0.6,
    "indicator_flag_threshold": 0.2,
    "skewness_threshold": 1.5,
}
TARGET = {"question.target": ("churned", "explicit")}


def run(
    profile: dict[str, object], facts: dict[str, tuple[str, str]] | None = None
) -> dict[str, Any]:
    return decide(
        RULE, facts={**TARGET, **(facts or {})}, profile={"rows": 100, **profile}, settings=SETTINGS
    )


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


def test_an_unmeasured_missing_share_is_an_error_not_zero() -> None:
    with pytest.raises(RuleError, match="missing_share"):
        run(column("age", skewness=0.1))


def test_models_that_fill_their_own_gaps_take_numeric_gaps_as_they_are() -> None:
    for facts in (FOREST, LINEAR, flow("mixed", "all", "all")):
        d = run(column("income", missing_share=0.1, skewness=2.4), facts)
        assert d["recommended_alternative_id"] == "pass_through"
        assert alternative(d, "pass_through")["applicability"] == "applicable"
        assert "params" not in alternative(d, "pass_through")
    assert any(e["label"].startswith("Models downstream that fill") for e in d["evidence"])


def test_models_that_fill_their_own_gaps_take_text_gaps_as_they_are() -> None:
    d = run(column("city", "String", missing_share=0.1), LINEAR)
    assert d["recommended_alternative_id"] == "pass_through"
    assert alternative(d, "impute_mean")["applicability"] == "not_applicable"


def test_a_target_with_gaps_is_dropped_even_when_models_fill_their_own() -> None:
    d = run(column("churned", "Int64", missing_share=0.1, skewness=0.1), FOREST)
    assert d["recommended_alternative_id"] == "drop_rows"
    assert alternative(d, "pass_through")["applicability"] == "not_applicable"


def test_clustering_downstream_needs_gaps_filled_here() -> None:
    d = run(column("age", missing_share=0.1, skewness=0.2), CLUSTERING)
    assert d["recommended_alternative_id"] == "impute_mean"
    assert "do not fill" in alternative(d, "pass_through")["reason"]


def test_a_forest_beside_clustering_needs_gaps_filled_here() -> None:
    d = run(column("city", "String", missing_share=0.1), flow("mixed", "some", "some"))
    assert d["recommended_alternative_id"] == "drop_rows"
    assert alternative(d, "pass_through")["applicability"] == "not_applicable"


def test_no_model_downstream_fills_gaps_as_before_and_says_so() -> None:
    d = run(column("age", missing_share=0.1, skewness=0.2))
    assert d["recommended_alternative_id"] == "impute_mean"
    assert "no model is downstream" in alternative(d, "pass_through")["reason"]
