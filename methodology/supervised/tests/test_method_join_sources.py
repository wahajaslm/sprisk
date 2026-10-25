"""Whether the one loaded table no step reads is joined to the rows the split reads
(ADR-0063 slice 6): only on one shared column where every row finds exactly one row;
anything else is a fact about the business, so a person says."""

from typing import Any

from method_harness import decide

METHOD = "common/join_sources"
KIND = "data.join_keys"


def keys(shared: list[str], matched: int = 100, most: int = 1, unread: int = 1) -> dict[str, Any]:
    return {
        KIND: {
            "unread_tables": unread,
            "rows": 100,
            "shared": shared,
            "key": shared[0] if len(shared) == 1 else "",
            "matched_rows": matched,
            "most_rows_per_key": most,
        }
    }


def test_one_key_matching_every_row_once_is_joined() -> None:
    d = decide(METHOD, evidence=keys(["unnamed_0"]))
    assert (d["outcome"], d["option"]) == ("choose", "join_on_key")
    assert d["reason"].startswith("Every one of the 100 rows finds exactly one row")


def test_no_shared_column_asks_a_person() -> None:
    d = decide(METHOD, evidence=keys([]))
    assert (d["outcome"], d["option"]) == ("ask", "single_source")
    assert "share no column" in d["reason"]


def test_several_shared_columns_ask_which_is_the_key() -> None:
    d = decide(METHOD, evidence=keys(["a", "b"]))
    assert d["outcome"] == "ask" and "a, b" in d["reason"]


def test_a_repeated_key_would_copy_rows_so_a_person_says() -> None:
    d = decide(METHOD, evidence=keys(["unnamed_0"], most=3))
    assert d["outcome"] == "ask" and "copy rows" in d["reason"]


def test_rows_without_a_match_would_join_with_gaps_so_a_person_says() -> None:
    d = decide(METHOD, evidence=keys(["unnamed_0"], matched=90))
    assert d["outcome"] == "ask" and "10 of 100 rows find no match" in d["reason"]


def test_over_time_a_person_confirms_the_other_table_was_known_in_time() -> None:
    d = decide(METHOD, evidence=keys(["unnamed_0"]), bound=["common.event_time"])
    assert (d["outcome"], d["option"]) == ("ask", "join_on_key")
    assert "prediction time" in d["reason"]


def test_with_no_one_unread_table_there_is_one_source() -> None:
    d = decide(METHOD)
    assert (d["outcome"], d["option"]) == ("choose", "single_source")
    assert "no step reads" in d["reason"]
