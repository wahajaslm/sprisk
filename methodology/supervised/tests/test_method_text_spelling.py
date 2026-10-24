"""Whether category text typed several ways is merged (ADR-0063 slice 6): trim and lowercase
the category columns whose values differ only in spaces or case; never an identifier, never
free text, never values that differ in accents."""

from typing import Any

from method_harness import decide

METHOD = "common/text_spelling"
KIND = "data.spelling_variants"


def variants(
    columns: list[str], identifier_like: list[str] | None = None, accent_only: list[str] | None = None
) -> dict[str, dict[str, Any]]:
    return {
        KIND: {
            "columns": columns,
            "identifier_like": identifier_like or [],
            "accent_only": accent_only or [],
            "text_columns": 4,
        }
    }


def test_category_text_typed_several_ways_is_trimmed_and_lowercased() -> None:
    d = decide(METHOD, evidence=variants(["city", "sex"]))
    assert (d["outcome"], d["option"]) == ("choose", "normalise")
    assert d["reason"].startswith("city, sex: values differ only in spaces or case")


def test_nothing_typed_several_ways_keeps_the_spelling() -> None:
    d = decide(METHOD, evidence=variants([]))
    assert (d["outcome"], d["option"]) == ("choose", "keep")


def test_identifiers_and_accents_are_named_and_left_as_typed() -> None:
    d = decide(METHOD, evidence=variants([], identifier_like=["sku"], accent_only=["colour"]))
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "sku" in d["reason"] and "identifies rows" in d["reason"]
    assert "colour" in d["reason"] and "accents" in d["reason"]


def test_unmeasured_text_keeps_the_spelling_and_says_why() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "not measured" in d["reason"]
