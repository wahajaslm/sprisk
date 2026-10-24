"""The question-stage rules of the common pack (ADR-0059): each checks a part of the question
and asks when it is missing or only guessed."""

from typing import Any

import pytest
from rule_harness import alternative, decide

Facts = dict[str, tuple[str, str]]


def ask(**facts: str) -> Facts:
    return {f"question.{k}": (v, "confirmed") for k, v in facts.items()}


def guessed(name: str, value: str) -> Facts:
    return {f"question.{name}": (value, "inferred")}


def task(value: str) -> Facts:
    return {"step.task": (value, "explicit")}


def states(d: dict[str, Any]) -> dict[str, str]:
    return {a["id"]: a["applicability"] for a in d["alternatives"]}


GOAL = {**ask(objective="Flag churn", task="classification")}


def test_a_stated_success_bar_is_the_bar() -> None:
    bar = ask(**{"success_bar.metric": "weighted_f1", "success_bar.score": "0.5"})
    d = decide("common/objective", facts={**GOAL, **bar})
    assert alternative(d, "stated")["applicability"] == "applicable"
    assert "weighted_f1 of at least 0.5" in alternative(d, "stated")["reason"]


def test_objective_asks_for_a_bar_before_any_run() -> None:
    d = decide("common/objective", facts=GOAL)
    assert states(d) == {"stated": "needs_fact", "exploration": "not_applicable"}
    assert "good enough" in alternative(d, "stated")["reason"]
    stated = decide("common/objective", facts={**GOAL, **ask(acceptance_criteria="AUC 0.8")})
    assert alternative(stated, "stated")["applicability"] == "applicable"


@pytest.mark.parametrize("origin", ["inferred", "measured"])
def test_objective_asks_about_a_bar_no_person_stated(origin: str) -> None:
    facts = {**GOAL, "question.acceptance_criteria": ("AUC 0.8", origin)}
    d = decide("common/objective", facts=facts)
    assert "confirm the success bar (AUC 0.8)" in alternative(d, "stated")["reason"]


def test_a_guessed_exploration_does_not_skip_the_bar_or_the_target() -> None:
    facts = {**ask(objective="Look around"), **guessed("task", "exploration")}
    assert (
        alternative(decide("common/objective", facts=facts), "exploration")["applicability"]
        == "needs_fact"
    )
    target = decide("common/target_definition", facts=guessed("task", "exploration"))
    assert target["recommended_alternative_id"] == "no_target"
    assert alternative(target, "no_target")["applicability"] == "needs_fact"


def test_target_is_used_when_confirmed_asked_when_guessed_and_never_built() -> None:
    d = decide("common/target_definition", facts=ask(target="churned", task="classification"))
    assert states(d) == {
        "column": "applicable",
        "no_target": "not_applicable",
        "derived": "not_applicable",
    }
    d = decide(
        "common/target_definition",
        facts={**guessed("target", "churned"), **ask(task="classification")},
    )
    assert alternative(d, "column")["applicability"] == "needs_fact"
    d = decide("common/target_definition", facts=ask(task="regression"))
    assert states(d)["column"] == "needs_fact" and states(d)["no_target"] == "needs_fact"


COSTS = {"question.costs.positive": ("bad", "explicit")}


def costs(miss: str, alarm: str, origin: str = "explicit") -> Facts:
    return {
        **COSTS,
        "question.costs.false_negative": (miss, origin),
        "question.costs.false_positive": (alarm, origin),
    }


def test_error_costs_record_stated_and_equal_costs() -> None:
    two = {"target.distinct": 2}
    stated = decide(
        "common/error_costs", facts={**task("classification"), **costs("5", "1")}, profile=two
    )
    assert states(stated) == {"stated": "applicable", "equal": "not_applicable"}
    equal = decide(
        "common/error_costs", facts={**task("classification"), **costs("1", "1")}, profile=two
    )
    assert equal["recommended_alternative_id"] == "equal"


def test_error_costs_ask_when_missing_or_guessed_and_do_not_apply_to_more_classes() -> None:
    two = {"target.distinct": 2}
    missing = decide("common/error_costs", facts=task("classification"), profile=two)
    assert set(states(missing).values()) == {"needs_fact"}
    guess = decide(
        "common/error_costs",
        facts={**task("classification"), **costs("1", "1", "inferred")},
        profile=two,
    )
    assert set(states(guess).values()) == {"needs_fact"}
    three = decide(
        "common/error_costs", facts=task("classification"), profile={"target.distinct": 3}
    )
    assert set(states(three).values()) == {"not_applicable"}
    assert "two classes" in alternative(three, "stated")["reason"]
    numbers = decide(
        "common/error_costs", facts=task("regression"), profile={"target.distinct": 300}
    )
    assert set(states(numbers).values()) == {"not_applicable"}


UNIT = {**ask(unit_of_analysis="customer", entity_column="customer_id")}


def test_unit_counts_whether_its_column_repeats_before_the_split() -> None:
    repeats = decide(
        "common/unit_of_prediction",
        facts=UNIT,
        profile={"input.rows": 100, "input.column.customer_id.distinct": 40},
    )
    assert repeats["recommended_alternative_id"] == "keep_rows_group_split"
    assert "groups by customer_id" in alternative(repeats, "keep_rows_group_split")["reason"]
    unique = decide(
        "common/unit_of_prediction",
        facts=UNIT,
        profile={"input.rows": 100, "input.column.customer_id.distinct": 100},
    )
    assert states(unique) == {
        "one_row_per_unit": "applicable",
        "keep_rows_group_split": "not_applicable",
        "aggregate": "not_applicable",
    }


def test_a_stated_unit_with_no_column_is_one_per_row_and_anything_else_asks() -> None:
    d = decide(
        "common/unit_of_prediction",
        facts=ask(unit_of_analysis="order"),
        profile={"input.rows": 100},
    )
    assert alternative(d, "one_row_per_unit")["applicability"] == "applicable"
    assert "each row is one order" in alternative(d, "one_row_per_unit")["reason"]
    nothing = decide("common/unit_of_prediction", facts={}, profile={"input.rows": 100})
    assert alternative(nothing, "one_row_per_unit")["applicability"] == "needs_fact"
    missing = decide("common/unit_of_prediction", facts=UNIT, profile={"input.rows": 100})
    assert "no column customer_id" in alternative(missing, "one_row_per_unit")["reason"]


def test_a_guessed_unit_column_is_measured_and_asked_about() -> None:
    facts = {**ask(unit_of_analysis="patient"), **guessed("entity_column", "patient_id")}
    d = decide(
        "common/unit_of_prediction",
        facts=facts,
        profile={"input.rows": 100, "input.column.patient_id.distinct": 30},
    )
    assert set(states(d).values()) == {"needs_fact", "not_applicable"}
    assert "Confirm patient_id" in alternative(d, "keep_rows_group_split")["reason"]
    assert any(e["value"] == "30" for e in d["evidence"])
