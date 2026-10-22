from typing import Any

from rule_harness import alternative, decide, manifest

RULE = "common/wrong_types"
SETTINGS = manifest(RULE)["policy_thresholds"]


def text(name: str, share: float, *unconverted: str, zeros: int = 0) -> dict[str, Any]:
    facts: dict[str, Any] = {
        f"input.column.{name}.data_type": "String",
        f"input.column.{name}.numeric_share": share,
        f"input.column.{name}.leading_zero_values": zeros,
    }
    if unconverted:
        facts[f"input.column.{name}.unconverted"] = list(unconverted)
    return facts


def run(profile: dict[str, Any]) -> dict[str, Any]:
    return decide(RULE, profile=profile, settings=SETTINGS)


def test_text_columns_that_read_as_numbers_in_full_are_cast() -> None:
    d = run({**text("age", 1.0), **text("bmi", 1.0), **text("city", 0.0)})
    assert d["recommended_alternative_id"] == "cast"
    assert alternative(d, "cast")["params"] == {"columns": ["age", "bmi"]}


def test_codes_with_leading_zeros_stay_text_and_are_named() -> None:
    d = run({**text("age", 1.0), **text("zip", 1.0, zeros=40)})
    cast = alternative(d, "cast")
    assert cast["params"] == {"columns": ["age"]}
    assert "zip" in cast["reason"]


def test_a_column_with_values_that_are_not_numbers_names_them_and_is_not_cast() -> None:
    d = run(text("age", 0.98, "?"))
    assert d["recommended_alternative_id"] == "keep"
    keep = alternative(d, "keep")
    assert keep["applicability"] == "needs_fact"
    assert "'?'" in keep["reason"] and "Placeholders" in keep["reason"]


def test_numbers_written_with_a_comma_are_named_as_such() -> None:
    keep = alternative(run(text("price", 0.6, "1,000", "2,5")), "keep")
    assert "comma" in keep["reason"]


def test_plain_text_is_left_alone() -> None:
    assert alternative(run(text("city", 0.1, "Paris")), "keep")["applicability"] == "applicable"
