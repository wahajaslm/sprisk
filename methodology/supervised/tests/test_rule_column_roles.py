"""The column-roles rule (ADR-0059): an identifier, a different whole number or one-word code
in every row, is left out before the split, so no model can memorise rows by it."""

from typing import Any

import pytest
from rule_harness import alternative, decide

from sprisk_workers.errors import RuleError

RULE = "common/column_roles"


def table(rows: int = 1000, **columns: tuple[str, int, float | None]) -> dict[str, Any]:
    """Each column gives (data type, distinct values, word share or None)."""
    facts: dict[str, Any] = {"input.rows": rows}
    for name, (data_type, distinct, words) in columns.items():
        facts[f"input.column.{name}.data_type"] = data_type
        facts[f"input.column.{name}.distinct"] = distinct
        if words is not None:
            facts[f"input.column.{name}.word_share"] = words
    return facts


RAKUTEN = table(
    unnamed_0=("Int64", 1000, None),
    designation=("String", 990, 0.98),
    description=("String", 600, 0.97),
    productid=("Int64", 1000, None),
    imageid=("Int64", 1000, None),
    prdtypecode=("Int64", 27, None),
)
TARGET = {"question.target": ("prdtypecode", "explicit")}


def test_identifiers_are_left_out_and_every_other_column_kept() -> None:
    d = decide(RULE, facts=TARGET, profile=RAKUTEN)
    assert d["recommended_alternative_id"] == "drop_identifiers"
    drop = alternative(d, "drop_identifiers")
    assert drop["applicability"] == "applicable"
    assert drop["params"] == {"columns": ["description", "designation", "prdtypecode"]}
    assert "imageid, productid, unnamed_0" in drop["reason"]


def test_free_text_and_unique_decimals_are_not_identifiers() -> None:
    profile = table(
        title=("String", 1000, 0.9), amount=("Float64", 1000, None), y=("Int64", 2, None)
    )
    d = decide(RULE, facts={"question.target": ("y", "explicit")}, profile=profile)
    assert d["recommended_alternative_id"] == "keep_all"
    assert alternative(d, "keep_all")["applicability"] == "applicable"


def test_one_word_text_codes_are_identifiers() -> None:
    profile = table(sku=("String", 1000, 0.0), price=("Float64", 300, None), y=("Int64", 2, None))
    d = decide(RULE, facts={"question.target": ("y", "explicit")}, profile=profile)
    assert alternative(d, "drop_identifiers")["params"] == {"columns": ["price", "y"]}


def test_the_target_and_the_entity_column_are_never_dropped() -> None:
    facts = {
        "question.target": ("ticket", "inferred"),
        "question.entity_column": ("customer", "explicit"),
    }
    profile = table(ticket=("Int64", 1000, None), customer=("Int64", 1000, None))
    d = decide(RULE, facts=facts, profile=profile)
    assert d["recommended_alternative_id"] == "keep_all"


def test_on_few_rows_a_column_unique_by_chance_stays_and_leaving_it_out_is_offered() -> None:
    profile = table(rows=40, age=("Int64", 40, None), city=("String", 5, 0.0), y=("Int64", 2, None))
    d = decide(RULE, facts={"question.target": ("y", "explicit")}, profile=profile)
    assert d["recommended_alternative_id"] == "keep_all"
    assert "40 rows" in alternative(d, "keep_all")["reason"]
    drop = alternative(d, "drop_identifiers")
    assert drop["applicability"] == "applicable"
    assert drop["params"] == {"columns": ["city", "y"]}


def test_a_time_column_with_a_different_value_in_every_row_stays_for_the_split() -> None:
    facts = {
        "question.target": ("y", "explicit"),
        "question.time_column": ("epoch_seconds", "explicit"),
    }
    profile = table(epoch_seconds=("Int64", 1000, None), y=("Int64", 2, None))
    assert decide(RULE, facts=facts, profile=profile)["recommended_alternative_id"] == "keep_all"


def test_when_every_column_differs_in_every_row_it_asks() -> None:
    d = decide(RULE, profile=table(a=("Int64", 1000, None), b=("String", 1000, 0.0)))
    assert alternative(d, "drop_identifiers")["applicability"] == "needs_fact"


@pytest.mark.parametrize(
    "missing", ["input.rows", "input.column.sku.distinct", "input.column.sku.word_share"]
)
def test_structure_without_a_count_or_word_share_is_a_broken_observation(missing: str) -> None:
    profile = table(sku=("String", 1000, 0.0), y=("Int64", 2, None))
    del profile[missing]
    with pytest.raises(RuleError, match=missing):
        decide(RULE, facts={"question.target": ("y", "explicit")}, profile=profile)


def test_a_duplicated_row_does_not_hide_an_identifier() -> None:
    profile = table(sku=("Int64", 999, None), price=("Float64", 300, None), y=("Int64", 2, None))
    profile["input.duplicate_rows"] = 1
    d = decide(RULE, facts={"question.target": ("y", "explicit")}, profile=profile)
    assert d["recommended_alternative_id"] == "drop_identifiers"


def test_leaving_out_every_feature_asks() -> None:
    profile = table(sku=("Int64", 1000, None), y=("Int64", 2, None))
    d = decide(RULE, facts={"question.target": ("y", "explicit")}, profile=profile)
    assert alternative(d, "drop_identifiers")["applicability"] == "needs_fact"
    assert "no column" in alternative(d, "drop_identifiers")["reason"]


def test_on_few_rows_a_lone_feature_unique_by_chance_simply_stays() -> None:
    profile = table(rows=60, age=("Int64", 60, None), y=("Int64", 2, None))
    d = decide(RULE, facts={"question.target": ("y", "explicit")}, profile=profile)
    assert d["recommended_alternative_id"] == "keep_all"
    assert alternative(d, "keep_all")["applicability"] == "applicable"
