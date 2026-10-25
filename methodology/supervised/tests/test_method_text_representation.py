"""Which text reaching a model is free text, turned into words (ADR-0063 slice 6): learnt from
the train rows in a step before the model; category text is left to encoding."""

from typing import Any

from method_harness import decide

METHOD = "supervised/text_representation"
KIND = "features.free_text"


def text(columns: list[str], categories: list[str] | None = None) -> dict[str, Any]:
    return {KIND: {"columns": columns, "categories": categories or [], "empty": []}}


def test_free_text_becomes_words() -> None:
    d = decide(METHOD, evidence=text(["designation", "description"]))
    assert (d["outcome"], d["option"]) == ("choose", "vectorize_words")
    assert d["reason"].startswith("designation, description: many values, most of several words")


def test_category_text_is_left_to_encoding() -> None:
    d = decide(METHOD, evidence=text([], categories=["colour"]))
    assert (d["outcome"], d["option"]) == ("choose", "no_free_text")
    assert "colour" in d["reason"]


def test_unmeasured_text_is_left_as_it_is_and_says_why() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "no_free_text")
    assert "not measured" in d["reason"]
