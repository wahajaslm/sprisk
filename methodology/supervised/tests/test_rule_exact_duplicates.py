from typing import Any

import pytest
from rule_harness import alternative, decide, manifest

from sprisk_workers.errors import RuleError

RULE = "common/exact_duplicates"
SETTINGS = manifest(RULE)["policy_thresholds"]


def run(**profile: Any) -> dict[str, Any]:
    return decide(RULE, profile={f"input.{k}": v for k, v in profile.items()}, settings=SETTINGS)


def test_a_few_copied_rows_are_dropped_before_the_split() -> None:
    d = run(rows=1000, duplicate_rows=12)
    assert d["recommended_alternative_id"] == "drop"
    assert alternative(d, "drop")["params"] == {}
    assert [e["value"] for e in d["evidence"]] == ["1000", "12"]


def test_no_copies_keep_every_row() -> None:
    d = run(rows=1000, duplicate_rows=0)
    assert alternative(d, "keep")["applicability"] == "applicable"
    assert alternative(d, "drop")["applicability"] == "not_applicable"


def test_many_copies_may_be_real_repeats_so_the_rule_asks() -> None:
    d = run(rows=1000, duplicate_rows=300)
    assert d["recommended_alternative_id"] == "keep"
    assert {a["applicability"] for a in d["alternatives"]} == {"needs_fact"}
    assert "30%" in alternative(d, "drop")["reason"]


def test_a_profile_without_a_duplicate_count_is_an_error_not_zero() -> None:
    with pytest.raises(RuleError, match="duplicate_rows"):
        run(rows=1000)
