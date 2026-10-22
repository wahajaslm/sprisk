"""The join rule (ADR-0059): a loaded table no step reads is joined to the rows the split reads
on the one column they share that matches cleanly; anything less clear asks."""

from typing import Any

import pytest
from rule_harness import alternative, decide

from sprisk_workers.errors import RuleError

RULE = "common/join_sources"


def other(rows: int = 100, **keys: tuple[int, int]) -> dict[str, Any]:
    """One unread table; each key gives (matched rows, most rows per key)."""
    facts: dict[str, Any] = {"join.unread_tables": 1, "join.rows": rows}
    for column, (matched, most) in keys.items():
        facts[f"join.key.{column}.matched_rows"] = matched
        facts[f"join.key.{column}.most_rows_per_key"] = most
    return facts


def test_with_no_unread_table_there_is_nothing_to_join() -> None:
    d = decide(RULE, profile={"join.unread_tables": 0})
    assert d["recommended_alternative_id"] == "single_source"
    assert alternative(d, "single_source")["applicability"] == "applicable"
    assert alternative(d, "join_on_key")["applicability"] == "not_applicable"


def test_one_shared_column_matching_every_row_once_is_joined_on() -> None:
    d = decide(RULE, profile=other(unnamed_0=(100, 1)))
    assert d["recommended_alternative_id"] == "join_on_key"
    join = alternative(d, "join_on_key")
    assert join["applicability"] == "applicable"
    assert join["params"] == {"key": "unnamed_0"}


def test_a_key_the_other_table_repeats_asks_since_rows_would_be_copied() -> None:
    join = alternative(decide(RULE, profile=other(unnamed_0=(100, 3))), "join_on_key")
    assert join["applicability"] == "needs_fact"
    assert "3 rows" in join["reason"]


def test_a_key_some_rows_do_not_match_asks_since_their_labels_would_be_missing() -> None:
    join = alternative(decide(RULE, profile=other(id=(99, 1))), "join_on_key")
    assert join["applicability"] == "needs_fact"
    assert "1 of 100" in join["reason"]


def test_several_shared_columns_or_none_ask() -> None:
    two = alternative(decide(RULE, profile=other(a=(100, 1), b=(0, 1))), "join_on_key")
    assert two["applicability"] == "needs_fact"
    assert "a, b" in two["reason"]
    none = alternative(decide(RULE, profile=other()), "join_on_key")
    assert none["applicability"] == "needs_fact"
    assert "share no column" in none["reason"]


def test_several_unread_tables_ask_which_to_join() -> None:
    d = decide(RULE, profile={"join.unread_tables": 2})
    join = alternative(d, "join_on_key")
    assert join["applicability"] == "needs_fact"
    assert "2 loaded tables" in join["reason"]


def test_join_facts_without_the_count_are_a_broken_observation() -> None:
    with pytest.raises(RuleError, match="join.unread_tables"):
        decide(RULE, profile={})


def test_a_question_over_time_asks_whether_the_other_table_is_known_in_time() -> None:
    timed = {"question.time_column": ("ordered_at", "confirmed")}
    join = alternative(decide(RULE, facts=timed, profile=other(id=(100, 1))), "join_on_key")
    assert join["applicability"] == "needs_fact"
    assert "prediction time" in join["reason"]
