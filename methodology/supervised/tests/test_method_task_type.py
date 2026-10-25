"""Whether the model predicts a class or a number (ADR-0063 slice 6): the question states the
task before the walk; the method takes it and promises the target fits it."""

from typing import Any

from method_harness import PACKS, decide

from sprisk_workers.method import load_function

METHOD = "common/task_type"
VERIFY = PACKS / "common/methods/task_type/method.py"


def shape(distinct: int, numeric: bool, whole: bool) -> dict[str, Any]:
    return {
        "rows": 1000,
        "distinct": distinct,
        "numeric": numeric,
        "whole_numbers": whole,
        "rarest_share": 0.01,
    }


def test_the_stated_task_is_taken() -> None:
    for task in ("classification", "regression"):
        d = decide(
            METHOD,
            task=task,
            evidence={"target.shape": shape(27, True, True)},
            bound=["common.target"],
        )
        assert (d["outcome"], d["option"]) == ("choose", task)


def test_whole_number_codes_are_classes() -> None:
    result, detail = load_function(VERIFY, "verify_labels_are_classes")(shape(27, True, True), {})
    assert result == "pass"
    assert "27" in detail


def test_decimal_values_are_not_classes() -> None:
    result, detail = load_function(VERIFY, "verify_labels_are_classes")(shape(300, True, False), {})
    assert result == "fail"
    assert "decimal" in detail


def test_one_label_is_nothing_to_predict() -> None:
    result, _ = load_function(VERIFY, "verify_labels_are_classes")(shape(1, False, False), {})
    assert result == "fail"


def test_text_is_not_a_number_to_predict() -> None:
    result, _ = load_function(VERIFY, "verify_labels_are_numbers")(shape(5, False, False), {})
    assert result == "fail"
    result, _ = load_function(VERIFY, "verify_labels_are_numbers")(shape(500, True, False), {})
    assert result == "pass"


def test_a_stated_task_whose_labels_broke_its_promise_asks_to_restate_the_question() -> None:
    decimals = "The target holds decimal values (812 distinct on the train rows): a quantity."
    d = decide(
        METHOD,
        evidence={"target.shape": shape(812, True, False)},
        bound=["common.target"],
        ruled_out={"classification": decimals},
    )
    # The task is the question's: only a new question revision changes it.
    assert d["answer"] == "refused"
    assert decimals in d["error"] and "restate the question's task" in d["error"]
