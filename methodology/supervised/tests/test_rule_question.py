"""The question-stage rules of the common pack (ADR-0059): each checks a part of the question
and asks when it is missing or only guessed."""

from typing import Any

import pytest
from rule_harness import alternative, decide

from sprisk_workers.errors import RuleError

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


def test_task_type_sets_the_model_steps_task_from_the_target_values() -> None:
    profile = {"target.data_type": "Int64", "target.distinct": 2}
    d = decide("common/task_type", facts=guessed("task", "undetermined"), profile=profile)
    assert alternative(d, "classification")["params"] == {"task": "classification"}
    many = {"target.data_type": "Float64", "target.distinct": 300}
    assert (
        decide("common/task_type", facts={}, profile=many)["recommended_alternative_id"]
        == "regression"
    )


def test_task_type_asks_about_few_numbers_many_texts_a_contradiction_and_a_constant() -> None:
    grades = decide(
        "common/task_type", facts={}, profile={"target.data_type": "Float64", "target.distinct": 5}
    )
    assert set(states(grades).values()) == {"needs_fact"}
    assert "5 numeric values" in alternative(grades, "classification")["reason"]
    texts = decide(
        "common/task_type",
        facts={},
        profile={"target.data_type": "String", "target.distinct": 5000},
    )
    assert set(states(texts).values()) == {"needs_fact"}
    clash = decide(
        "common/task_type",
        facts=ask(task="regression"),
        profile={"target.data_type": "Int64", "target.distinct": 2},
    )
    assert clash["recommended_alternative_id"] == "regression"
    assert "reads as classification" in alternative(clash, "regression")["reason"]
    one = decide(
        "common/task_type", facts={}, profile={"target.data_type": "Int64", "target.distinct": 1}
    )
    assert "nothing to predict" in alternative(one, "regression")["reason"]


def test_task_type_without_the_target_type_is_an_error_not_a_guess() -> None:
    with pytest.raises(RuleError, match="target.data_type"):
        decide("common/task_type", facts={}, profile={"target.distinct": 2})


def test_class_balance_compares_the_rarest_class_with_an_even_share() -> None:
    rare = decide(
        "common/class_balance",
        facts=task("classification"),
        profile={"target.distinct": 2, "target.rarest_share": 0.04},
    )
    assert states(rare) == {"unbalanced": "applicable", "balanced": "not_applicable"}
    assert [e["value"] for e in rare["evidence"] if e["kind"] == "profile_fact"] == ["4.0%", "2"]
    even = decide(
        "common/class_balance",
        facts=task("classification"),
        profile={"target.distinct": 15, "target.rarest_share": 0.066},
    )
    assert even["recommended_alternative_id"] == "balanced"
    two = decide(
        "common/class_balance",
        facts=task("classification"),
        profile={"target.distinct": 2, "target.rarest_share": 0.3},
    )
    assert two["recommended_alternative_id"] == "balanced"


def test_class_balance_asks_with_too_many_classes_and_skips_regression() -> None:
    many = decide(
        "common/class_balance", facts=task("classification"), profile={"target.distinct": 40}
    )
    assert set(states(many).values()) == {"needs_fact"}
    numbers = decide(
        "common/class_balance", facts=task("regression"), profile={"target.distinct": 300}
    )
    assert set(states(numbers).values()) == {"not_applicable"}


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
