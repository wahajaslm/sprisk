"""Which placeholders stand for missing numbers (ADR-0063 slice 6): known ones are marked in a
step before the split; a value that may be real is named and left as typed."""

from typing import Any

from method_harness import decide

METHOD = "common/missing_markers"
KIND = "data.missing_markers"


def markers(columns: list[str], values: list[str], unknown: list[str]) -> dict[str, Any]:
    return {KIND: {"columns": columns, "values": values, "unknown": unknown}}


def test_known_placeholders_are_marked_missing() -> None:
    d = decide(METHOD, evidence=markers(["age"], ["?", "n/a"], []))
    assert (d["outcome"], d["option"]) == ("choose", "mark")
    assert d["reason"].startswith("age: mostly numbers, with placeholders '?', 'n/a'")


def test_a_value_that_may_be_real_is_named_and_left_as_typed() -> None:
    d = decide(METHOD, evidence=markers([], [], ["code: 'NA'"]))
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "code: 'NA'" in d["reason"] and "may be a real value" in d["reason"]


def test_no_placeholder_keeps_the_values() -> None:
    d = decide(METHOD, evidence=markers([], [], []))
    assert (d["outcome"], d["option"]) == ("choose", "keep")


def test_unmeasured_text_keeps_the_values_and_says_why() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "not measured" in d["reason"]
