from typing import Any

from rule_harness import alternative, decide, manifest

RULE = "common/missing_markers"
SETTINGS = manifest(RULE)["policy_thresholds"]


def text(name: str, share: float, *unconverted: str) -> dict[str, Any]:
    facts: dict[str, Any] = {
        f"input.column.{name}.data_type": "String",
        f"input.column.{name}.numeric_share": share,
    }
    if unconverted:
        facts[f"input.column.{name}.unconverted"] = list(unconverted)
    return facts


def run(profile: dict[str, Any]) -> dict[str, Any]:
    return decide(RULE, profile=profile, settings=SETTINGS)


def test_known_placeholders_in_mostly_numeric_columns_are_marked_before_the_split() -> None:
    d = run({**text("age", 0.98, "?", "n/a"), **text("bmi", 0.99, "?"), **text("city", 0.0)})
    assert d["recommended_alternative_id"] == "mark"
    assert alternative(d, "mark")["params"] == {"columns": ["age", "bmi"], "values": ["?", "n/a"]}
    assert alternative(d, "keep")["applicability"] == "not_applicable"


def test_many_placeholders_do_not_stop_a_column_from_being_marked() -> None:
    d = run(text("bilirubin", 0.9, "?"))
    assert alternative(d, "mark")["params"] == {"columns": ["bilirubin"], "values": ["?"]}


def test_a_padded_placeholder_is_known_and_marked_as_it_is_written() -> None:
    d = run(text("workclass_hours", 0.95, " ?"))
    assert alternative(d, "mark")["params"] == {"columns": ["workclass_hours"], "values": [" ?"]}


def test_a_value_that_may_be_real_is_not_marked_and_is_asked_about() -> None:
    d = run(text("country", 0.97, "NA"))
    assert d["recommended_alternative_id"] == "keep"
    assert alternative(d, "mark")["applicability"] == "not_applicable"
    keep = alternative(d, "keep")
    assert keep["applicability"] == "needs_fact"
    assert "'NA'" in keep["reason"]


def test_a_column_with_known_and_other_values_marks_the_known_and_shows_both() -> None:
    d = run(text("age", 0.97, "?", "NA"))
    assert d["recommended_alternative_id"] == "mark"
    assert alternative(d, "mark")["params"] == {"columns": ["age"], "values": ["?"]}
    keep = alternative(d, "keep")
    assert keep["applicability"] == "needs_fact"
    assert "'NA'" in keep["reason"]
    assert [e["value"] for e in d["evidence"]] == ["'?', 'NA'"]


def test_text_columns_and_columns_with_many_odd_values_are_left_alone() -> None:
    d = run({**text("notes", 0.3, "?", "late"), **text("code", 0.97, "a", "b", "c", "d", "e", "f")})
    assert d["recommended_alternative_id"] == "keep"
    assert alternative(d, "keep")["applicability"] == "applicable"
