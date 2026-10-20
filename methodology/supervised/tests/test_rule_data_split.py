from typing import Any

from rule_harness import alternative
from rule_harness import decide as run

RULE = "supervised/data_split"


def decide(facts: dict[str, tuple[str, str]]) -> dict[str, Any]:
    return run(RULE, facts=facts)


TARGET = {
    "question.target": ("churned", "explicit"),
    "question.task": ("classification", "explicit"),
}


def test_a_confirmed_time_column_recommends_a_temporal_split() -> None:
    d = decide({**TARGET, "question.time_column": ("signup_date", "confirmed")})
    assert d["recommended_alternative_id"] == "temporal"
    assert alternative(d, "temporal")["params"] == {
        "time_column": "signup_date",
        "test_fraction": 0.2,
    }


def test_an_inferred_time_column_needs_confirming_and_never_decides() -> None:
    d = decide({**TARGET, "question.time_column": ("signup_date", "inferred")})
    assert alternative(d, "temporal")["applicability"] == "needs_fact"
    assert "params" not in alternative(d, "temporal")
    assert d["recommended_alternative_id"] == "stratified_random"


def test_a_confirmed_entity_column_keeps_each_entity_on_one_side() -> None:
    d = decide({**TARGET, "question.entity_column": ("customer_id", "confirmed")})
    assert d["recommended_alternative_id"] == "entity_group"
    assert alternative(d, "entity_group")["params"] == {
        "group_column": "customer_id",
        "test_fraction": 0.2,
        "seed": 42,
    }


def test_classification_stratifies_on_the_target() -> None:
    d = decide(TARGET)
    assert alternative(d, "stratified_random")["params"]["stratify"] == "churned"


def test_regression_never_stratifies_on_a_continuous_target() -> None:
    d = decide(
        {"question.target": ("price", "explicit"), "question.task": ("regression", "explicit")}
    )
    assert d["recommended_alternative_id"] == "simple_random"
    assert alternative(d, "stratified_random")["applicability"] == "not_applicable"


def test_every_fact_read_is_recorded_as_evidence() -> None:
    d = decide({**TARGET, "question.time_column": ("signup_date", "confirmed")})
    labels = {e["label"]: e["origin"] for e in d["evidence"]}
    assert labels == {"Target": "explicit", "Task": "explicit", "Time column": "confirmed"}


def test_a_confirmed_time_column_offers_only_the_temporal_split() -> None:
    d = decide(
        {
            **TARGET,
            "question.time_column": ("signup_date", "confirmed"),
            "question.entity_column": ("customer_id", "confirmed"),
        }
    )
    offered = [a["id"] for a in d["alternatives"] if a["applicability"] == "applicable"]
    assert offered == ["temporal"]


def test_a_confirmed_entity_column_offers_only_the_group_split() -> None:
    d = decide({**TARGET, "question.entity_column": ("customer_id", "confirmed")})
    offered = [a["id"] for a in d["alternatives"] if a["applicability"] == "applicable"]
    assert offered == ["entity_group"]


def test_time_and_entity_together_split_by_time_and_purge_shared_entities() -> None:
    d = decide(
        {
            **TARGET,
            "question.time_column": ("signup_date", "confirmed"),
            "question.entity_column": ("customer_id", "confirmed"),
        }
    )
    assert d["recommended_alternative_id"] == "temporal"
    assert alternative(d, "temporal")["params"] == {
        "time_column": "signup_date",
        "test_fraction": 0.2,
        "group_column": "customer_id",
    }
    assert "customer_id" in alternative(d, "temporal")["reason"]


def test_a_prediction_horizon_is_named_as_a_gap_the_split_does_not_leave() -> None:
    d = decide(
        {
            **TARGET,
            "question.time_column": ("signup_date", "confirmed"),
            "question.prediction_horizon": ("P30D", "explicit"),
        }
    )
    assert "P30D" in alternative(d, "temporal")["reason"]
