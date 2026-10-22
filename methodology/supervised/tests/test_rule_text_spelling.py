from typing import Any

from rule_harness import alternative, decide

RULE = "common/text_spelling"
TARGET = {"question.target": ("churned", "confirmed")}


def text(name: str, case: int, accent: int = 0) -> dict[str, Any]:
    return {
        f"input.column.{name}.data_type": "String",
        f"input.column.{name}.case_variants": case,
        f"input.column.{name}.accent_variants": accent,
    }


def run(profile: dict[str, Any]) -> dict[str, Any]:
    return decide(RULE, facts=TARGET, profile=profile)


def test_columns_differing_only_in_spaces_or_case_are_trimmed_and_lowercased() -> None:
    d = run({**text("city", 3), **text("plan", 1), **text("notes", 0)})
    assert alternative(d, "normalise")["params"] == {"columns": ["city", "plan"], "lowercase": True}
    assert alternative(d, "keep")["applicability"] == "not_applicable"


def test_the_target_is_never_changed_and_its_labels_are_asked_about() -> None:
    d = run({**text("churned", 1), **text("city", 2)})
    assert alternative(d, "normalise")["params"]["columns"] == ["city"]
    keep = alternative(d, "keep")
    assert keep["applicability"] == "needs_fact" and "one class" in keep["reason"]


def test_accent_only_variants_are_named_not_merged() -> None:
    d = run(text("name", 0, accent=2))
    assert d["recommended_alternative_id"] == "keep"
    assert alternative(d, "normalise")["applicability"] == "not_applicable"
    keep = alternative(d, "keep")
    assert keep["applicability"] == "needs_fact" and "accents" in keep["reason"]
    assert keep["reason"].count("say") == 1
