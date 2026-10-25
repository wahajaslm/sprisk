"""Whether rows that copy an earlier one are dropped before the split (ADR-0063 slice 6): a
few copies are load errors; many may be real repeated observations, so a person says."""

from typing import Any

from method_harness import decide

METHOD = "common/exact_duplicates"
KIND = "data.duplicate_rows"
ORDER = {"data.html_text": "keep", "data.column_roles": "keep_all"}


def copies(duplicates: int, rows: int = 1000) -> dict[str, Any]:
    return {KIND: {"rows": rows, "duplicates": duplicates}}


def test_a_few_copies_are_dropped() -> None:
    d = decide(
        METHOD,
        evidence=copies(12),
        decisions={"data.html_text": "keep", "data.column_roles": "drop_identifiers"},
    )
    assert (d["outcome"], d["option"]) == ("choose", "drop")
    assert d["reason"].startswith("12 of 1000 rows repeat an earlier row")


def test_no_copy_keeps_every_row() -> None:
    d = decide(METHOD, evidence=copies(0), decisions=ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "keep")


def test_many_copies_may_be_real_observations_so_a_person_says() -> None:
    d = decide(METHOD, evidence=copies(200), decisions=ORDER)
    assert (d["outcome"], d["option"]) == ("ask", "keep")
    assert "20%" in d["reason"]


def test_unmeasured_rows_all_stay_and_it_says_why() -> None:
    d = decide(METHOD, decisions=ORDER)
    assert (d["outcome"], d["option"]) == ("choose", "keep")
    assert "not measured" in d["reason"]
