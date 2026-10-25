"""Which text columns are numbers stored as text (ADR-0063 slice 6): cast in a step before
the split, once the placeholders the markers decision marked are gaps; codes with leading
zeros and numbers written with a comma stay text."""

from typing import Any

from method_harness import decide

METHOD = "common/wrong_types"
KIND = "data.number_text"


def numbers(
    as_is: list[str],
    once_marked: list[str] | None = None,
    codes: list[str] | None = None,
    comma: list[str] | None = None,
) -> dict[str, Any]:
    return {
        KIND: {
            "numbers": as_is,
            "numbers_once_marked": once_marked if once_marked is not None else as_is,
            "codes": codes or [],
            "comma_numbers": comma or [],
        }
    }


def test_numbers_stored_as_text_are_cast() -> None:
    d = decide(METHOD, evidence=numbers(["price"]), decisions={"data.missing_markers": "keep"})
    assert (d["outcome"], d["option"]) == ("choose", "cast")
    assert d["reason"].startswith("price: every value reads as a number")


def test_columns_whose_placeholders_were_marked_are_cast_with_them() -> None:
    found = numbers(["price"], once_marked=["price", "age"])
    d = decide(METHOD, evidence=found, decisions={"data.missing_markers": "mark"})
    assert (d["outcome"], d["option"]) == ("choose", "cast_marked")
    assert d["reason"].startswith("price, age:")


def test_placeholders_left_unmarked_keep_their_column_text() -> None:
    found = numbers([], once_marked=["age"])
    d = decide(METHOD, evidence=found, decisions={"data.missing_markers": "keep"})
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "age" in d["reason"]


def test_codes_and_comma_numbers_are_named_and_stay_text() -> None:
    found = numbers([], codes=["zip"], comma=["amount: '1,000', '2,5'"])
    d = decide(METHOD, evidence=found, decisions={"data.missing_markers": "keep"})
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "zip" in d["reason"] and "leading zeros" in d["reason"]
    assert "'1,000'" in d["reason"] and "comma" in d["reason"]


def test_unmeasured_text_keeps_the_types_and_says_why() -> None:
    d = decide(METHOD, decisions={"data.missing_markers": "keep"})
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "not measured" in d["reason"]
