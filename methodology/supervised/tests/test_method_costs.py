"""What each mistake costs, and the decision threshold it sets (ADR-0063 slice 6): a
two-class question predicts at the cheapest threshold when a person stated the costs."""

from typing import Any

import pytest
from method_harness import decide

COSTS = {"positive": "churned", "false_negative": 5.0, "false_positive": 1.0}


def shape(distinct: int) -> dict[str, Any]:
    return {
        "target.shape": {
            "rows": 100,
            "distinct": distinct,
            "numeric": False,
            "whole_numbers": False,
            "rarest_share": 0.2,
        }
    }


def test_two_classes_with_no_costs_ask_what_each_mistake_costs() -> None:
    d = decide("common/error_costs", evidence=shape(2), statements={})
    assert (d["outcome"], d["option"]) == ("ask", "equal")
    assert "costly class" in d["reason"]


def test_stated_costs_that_differ_are_recorded() -> None:
    d = decide("common/error_costs", evidence=shape(2), statements={"costs": COSTS})
    assert (d["outcome"], d["option"]) == ("choose", "stated")


def test_equal_stated_costs_are_equal() -> None:
    same = {**COSTS, "false_positive": 5.0}
    d = decide("common/error_costs", evidence=shape(2), statements={"costs": same})
    assert (d["outcome"], d["option"]) == ("choose", "equal")


def test_more_than_two_classes_need_no_costs() -> None:
    d = decide("common/error_costs", evidence=shape(27), statements={})
    assert (d["outcome"], d["option"]) == ("choose", "not_two_classes")


def threshold(costs: str = "stated", split: str = "stratified_random", classes: int = 2) -> Any:
    return decide(
        "supervised/decision_threshold",
        evidence=shape(classes),
        decisions={"question.error_costs": costs, "split.method": split},
    )


def test_costs_that_differ_set_the_cheapest_threshold() -> None:
    d = threshold()
    assert (d["outcome"], d["option"]) == ("choose", "cost_optimal_threshold")


def test_equal_stated_costs_go_on_the_model_so_models_are_compared_by_cost() -> None:
    d = threshold(costs="equal")
    assert (d["outcome"], d["option"]) == ("choose", "cost_optimal_threshold")
    assert d["reason"].startswith("Both mistakes cost the same")


def test_no_costs_keep_the_likelier_class() -> None:
    d = threshold(costs="not_two_classes")
    assert (d["outcome"], d["option"]) == ("choose", "default_half")


@pytest.mark.parametrize("split", ["temporal", "item_groups"])
def test_a_split_in_time_or_by_item_keeps_the_default_threshold(split: str) -> None:
    d = threshold(split=split)
    assert (d["outcome"], d["option"]) == ("choose", "default_half")
    assert "inner folds" in d["reason"]


def test_more_than_two_classes_keep_the_default_threshold() -> None:
    d = threshold(classes=27)
    assert (d["outcome"], d["option"]) == ("choose", "default_half")
