"""Which text columns have their HTML stripped before the split (ADR-0063 slice 6): markup
counted as words splits 'caf&eacute;' from 'café'; the target, item and time columns stay."""

from typing import Any

from method_harness import decide

METHOD = "common/html_text"
KIND = "data.html_text"


def html(columns: list[str], held: list[str] | None = None) -> dict[str, Any]:
    return {KIND: {"columns": columns, "held": held or []}}


def test_feature_text_holding_html_is_stripped() -> None:
    d = decide(METHOD, evidence=html(["description"]))
    assert (d["outcome"], d["option"]) == ("choose", "strip")
    assert d["reason"].startswith("description: values hold HTML tags or entities")


def test_the_target_holding_html_is_named_and_left_as_it_is() -> None:
    d = decide(METHOD, evidence=html([], held=["label"]))
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "label" in d["reason"]


def test_unmeasured_text_keeps_its_markup_and_says_why() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "not measured" in d["reason"]
