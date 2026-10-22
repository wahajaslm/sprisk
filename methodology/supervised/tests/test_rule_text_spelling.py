from typing import Any

from rule_harness import alternative, decide

RULE = "common/text_spelling"
TARGET = {"question.target": ("churned", "confirmed")}


def text(name: str, case: int, accent: int = 0, distinct: int = 20) -> dict[str, Any]:
    return {
        f"input.column.{name}.data_type": "String",
        f"input.column.{name}.case_variants": case,
        f"input.column.{name}.accent_variants": accent,
        f"input.column.{name}.distinct": distinct,
    }


def run(profile: dict[str, Any], facts: dict[str, tuple[str, str]] | None = None) -> dict[str, Any]:
    return decide(RULE, facts={**TARGET, **(facts or {})}, profile={"input.rows": 1000, **profile})


def test_columns_differing_only_in_spaces_or_case_are_trimmed_and_lowercased() -> None:
    d = run({**text("city", 3), **text("plan", 1), **text("notes", 0)})
    assert alternative(d, "normalise")["params"] == {
        "columns": ["city", "plan"],
        "lowercase": True,
        "empty_to_null": False,
    }
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


def test_unit_time_and_identifier_like_columns_are_asked_about_not_lowercased() -> None:
    facts = {
        "question.entity_column": ("customer_id", "confirmed"),
        "question.time_column": ("signup", "confirmed"),
    }
    d = run(
        {
            **text("city", 3),
            **text("customer_id", 2),
            **text("signup", 1),
            **text("code", 4, distinct=900),
        },
        facts,
    )
    assert alternative(d, "normalise")["params"]["columns"] == ["city"]
    keep = alternative(d, "keep")
    assert keep["applicability"] == "needs_fact"
    for name in ("customer_id", "signup", "code"):
        assert name in keep["reason"]
