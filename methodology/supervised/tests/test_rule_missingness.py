from typing import Any

import pytest
from rule_harness import (
    CLUSTERING,
    FOREST,
    LINEAR,
    alternative,
    column,
    decide,
    flow,
    step,
)

from sprisk_workers.errors import RuleError

RULE = "supervised/missingness"
SETTINGS = {
    "drop_column_threshold": 0.6,
    "indicator_flag_threshold": 0.2,
    "skewness_threshold": 1.5,
    "high_cardinality_threshold": 15,
    "category_text_fill": "missing",
    "free_text_fill": "",
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


def test_category_gaps_get_a_named_category_and_free_text_gaps_no_words() -> None:
    d = run(
        {
            **column("ward", "String", missing_share=0.1, distinct=6),
            **column("description", "String", missing_share=0.35, distinct=50_000),
            **column("income", missing_share=0.1, skewness=2.4),
        }
    )
    assert d["recommended_alternative_id"] == "impute_median"
    median = alternative(d, "impute_median")
    assert median["params"] == {
        "columns": ["description", "income", "ward"],
        "method": "median",
        "text_fill": {"ward": "missing", "description": ""},
    }
    assert "ward" in median["reason"] and "description" in median["reason"]


def test_the_fills_are_settings() -> None:
    settings = {**SETTINGS, "category_text_fill": "unknown"}
    d = decide(
        RULE,
        facts=TARGET,
        profile={"rows": 100, **column("ward", "String", missing_share=0.1, distinct=6)},
        settings=settings,
    )
    assert alternative(d, "impute_mean")["params"]["text_fill"] == {"ward": "unknown"}


def test_gaps_in_a_column_neither_number_nor_text_drop_rows() -> None:
    d = run(column("opened", "Date", missing_share=0.1))
    assert d["recommended_alternative_id"] == "drop_rows"
    assert "opened" in alternative(d, "impute_median")["reason"]
    assert alternative(d, "impute_median")["applicability"] == "not_applicable"


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


def test_gaps_are_handled_here_whatever_models_are_downstream() -> None:
    # A model fits only the model (ADR-0056): it refuses gaps, so none may pass through.
    for facts in (FOREST, LINEAR, CLUSTERING, flow("linear, tree_ensemble")):
        d = run(column("income", missing_share=0.1, skewness=2.4), facts)
        assert d["recommended_alternative_id"] == "impute_median"
        assert "pass_through" not in {a["id"] for a in d["alternatives"]}


def test_a_target_with_gaps_is_dropped_whatever_models_are_downstream() -> None:
    d = run(column("churned", "Int64", missing_share=0.1, skewness=0.1), FOREST)
    assert d["recommended_alternative_id"] == "drop_rows"


def test_text_gaps_are_filled_whatever_models_are_downstream() -> None:
    d = run(column("notes", "String", missing_share=0.1, distinct=900), LINEAR)
    assert d["recommended_alternative_id"] == "impute_mean"
    assert alternative(d, "impute_mean")["params"]["text_fill"] == {"notes": ""}


def test_a_zero_fill_asks_before_any_other_fill_replaces_it() -> None:
    d = run(column("age", missing_share=0.1, skewness=0.2), step(method="zero"))
    for id in ("impute_mean", "impute_median"):
        assert alternative(d, id)["applicability"] == "needs_fact", id
        assert "zero" in alternative(d, id)["reason"], id


def test_a_column_that_may_be_the_target_asks_before_any_fill() -> None:
    d = decide(
        RULE,
        facts={"question.target": ("churned", "inferred")},
        profile={"rows": 100, **column("churned", "Int64", missing_share=0.1, skewness=0.1)},
        settings=SETTINGS,
    )
    for id in ("impute_mean", "impute_median"):
        assert alternative(d, id)["applicability"] == "needs_fact", id
    assert d["recommended_alternative_id"] == "drop_rows"
