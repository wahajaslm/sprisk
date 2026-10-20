"""Every active rule's manifest examples hold (ADR-0045): each picks what it says, and each
decision offers exactly the manifest's menu. A change to decide() that changes a choice fails
here, so it is made on purpose, with its example."""

import json
from typing import Any

import pytest
from rule_harness import PACKS, covers, manifest, run_example

ACTIVE = sorted(
    f"{p.parents[2].name}/{p.parent.name}"
    for p in PACKS.glob("*/rules/*/rule.yaml")
    if manifest(f"{p.parents[2].name}/{p.parent.name}")["status"] == "active"
)
CASES = [
    pytest.param(rule, example, id=f"{rule}#{i + 1}")
    for rule in ACTIVE
    for i, example in enumerate(manifest(rule)["examples"])
]


def test_the_active_rules_are_the_ones_with_code() -> None:
    coded = {f"{p.parents[2].name}/{p.parent.name}" for p in PACKS.glob("*/rules/*/rule.py")}
    assert set(ACTIVE) == coded


@pytest.mark.parametrize(("rule", "example"), CASES)
def test_an_example_picks_what_it_says_and_offers_the_whole_menu(
    rule: str, example: dict[str, Any]
) -> None:
    d = run_example(rule, example)
    assert d["recommended_alternative_id"] == example["picks"], d
    menu = sorted(a["id"] for a in manifest(rule)["alternatives"])
    assert sorted(a["id"] for a in d["alternatives"]) == menu


def test_a_reads_pattern_covers_the_fact_names_the_shared_cases_say() -> None:
    # The same cases run in Rust (sprisk-methodology tests), so both match reads alike.
    cases = json.loads(
        (PACKS.parent / "crates/sprisk-methodology/tests/fixtures/fact_patterns.json").read_text()
    )
    for case in cases:
        assert covers(case["pattern"], case["name"]) == case["covers"], case
