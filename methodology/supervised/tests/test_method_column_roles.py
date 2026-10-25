"""Which columns only name rows (ADR-0063 slice 6): left out in a step before the split, so a
model cannot memorise rows by them; kept on few rows, where being unique may be chance."""

from typing import Any

from method_harness import decide

METHOD = "common/column_roles"
KIND = "data.identifiers"


def identifiers(columns: list[str], rows: int = 500, features_left: int = 3) -> dict[str, Any]:
    return {KIND: {"columns": columns, "rows": rows, "features_left": features_left}}


def test_identifiers_are_left_out() -> None:
    d = decide(METHOD, evidence=identifiers(["row_id", "sku"]))
    assert (d["outcome"], d["option"]) == ("choose", "drop_identifiers")
    assert d["reason"].startswith("row_id, sku hold a different value in every row")


def test_no_identifier_keeps_every_column() -> None:
    d = decide(METHOD, evidence=identifiers([]))
    assert (d["outcome"], d["option"]) == ("choose", "keep_all")


def test_on_few_rows_being_unique_may_be_chance_so_they_stay() -> None:
    d = decide(METHOD, evidence=identifiers(["code"], rows=40))
    assert (d["outcome"], d["option"]) == ("choose", "keep_all")
    assert "only 40 rows" in d["reason"]


def test_leaving_no_column_to_learn_from_asks_a_person() -> None:
    d = decide(METHOD, evidence=identifiers(["row_id"], features_left=0))
    assert (d["outcome"], d["option"]) == ("ask", "keep_all")
    assert "no column to learn from" in d["reason"]


def test_unmeasured_columns_all_stay_and_it_says_why() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "keep_all")
    assert "not measured" in d["reason"]
