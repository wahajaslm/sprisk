import json
from pathlib import Path
from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import load_decide

RULE = Path(__file__).parents[1] / "rules" / "data_split" / "rule.py"
SETTINGS = {"default_test_fraction": 0.2, "default_seed": 42}


def decide(facts: dict[str, tuple[str, str]]) -> dict[str, Any]:
    observation = RuleObservation.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_observation/v1",
                "rule": "methodology.supervised.data_split@1.0.0",
                "facts": {k: {"value": v, "origin": o} for k, (v, o) in facts.items()},
                "profile": {},
                "settings": SETTINGS,
            }
        )
    )
    decision: RuleDecision = load_decide(RULE)(observation)
    result: dict[str, Any] = json.loads(decision.model_dump_json())
    return result


def alternative(decision: dict[str, Any], id: str) -> dict[str, Any]:
    return next(a for a in decision["alternatives"] if a["id"] == id)


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
