from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/date_parts"


def run(profile: dict[str, object]) -> dict[str, Any]:
    return decide(RULE, profile={"rows": 750, **profile}, settings={})


def test_a_date_reaching_the_model_is_split_into_parts_before_it() -> None:
    d = run(
        {
            **column("opened", "Date", distinct=300),
            **column("closed_at", "Datetime(time_unit='us', time_zone=None)", distinct=700),
            **column("age", "Int64", distinct=53),
        }
    )
    assert d["recommended_alternative_id"] == "date_parts"
    assert alternative(d, "date_parts")["params"] == {"columns": ["closed_at", "opened"]}
    assert {
        "kind": "profile_fact",
        "label": "opened type",
        "value": "Date",
        "origin": "measured",
    } in d["evidence"]


def test_with_no_date_there_is_nothing_to_add() -> None:
    d = run({**column("age", "Int64", distinct=53), **column("purpose", "String", distinct=10)})
    assert d["recommended_alternative_id"] == "no_dates"
    assert alternative(d, "date_parts")["applicability"] == "not_applicable"
    assert alternative(d, "no_dates")["applicability"] == "applicable"
