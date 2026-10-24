"""How rows are divided into training and test so the score is fair (ADR-0063): by time when
a time column orders them, by item when rows repeat an item, else at random."""

import importlib.util
from collections.abc import Mapping

import pytest
from method_harness import PACKS, decide

METHOD = "supervised/split_method"
METHOD_FILE = "supervised/methods/split_method/method.py"
INDEPENDENT = {"data.repeated_items": "independent_rows"}
TARGET = "common.target"


@pytest.mark.parametrize(
    ("bound", "task", "option"),
    [
        ([TARGET, "common.event_time", "common.item_identity"], "classification", "temporal"),
        ([TARGET, "common.item_identity"], "classification", "item_groups"),
        ([TARGET], "classification", "stratified_random"),
        ([TARGET], "regression", "simple_random"),
        ([TARGET, "common.item_identity"], "regression", "item_groups"),
    ],
)
def test_the_split_follows_what_orders_or_groups_the_rows(
    bound: list[str], task: str, option: str
) -> None:
    d = decide(METHOD, task=task, decisions=INDEPENDENT, bound=bound)
    assert (d["outcome"], d["option"]) == ("choose", option)


def test_repeated_items_split_by_item_once_their_identity_is_bound() -> None:
    grouped = {"data.repeated_items": "group_by_title"}
    d = decide(METHOD, decisions=grouped, bound=[TARGET, "common.item_identity"])
    assert d["option"] == "item_groups"
    assert "no item is scored on rows the model saw" in d["reason"]


def verify(
    name: str, evidence: Mapping[str, object], settings: Mapping[str, object] | None = None
) -> tuple[str, str]:
    """A promise's check, as slice 5 runs it on the split's outputs."""
    spec = importlib.util.spec_from_file_location("split_method", PACKS / METHOD_FILE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    verdict: tuple[str, str] = getattr(module, f"verify_{name}")(evidence, settings or {})
    return verdict


def overlap(count: int, groups: list[str]) -> dict[str, object]:
    return {
        "overlapping": count,
        "overlapping_groups": groups,
        "train_groups": 40,
        "test_groups": 10,
    }


def test_an_item_on_both_sides_fails_the_group_promise_and_names_it() -> None:
    verdict, reason = verify("no_group_overlap", overlap(3, ["7", "9", "12"]))
    assert verdict == "fail"
    assert reason.startswith("3 items have rows in both train and test: 7, 9, 12")
    assert verify("no_group_overlap", overlap(0, []))[0] == "pass"


def test_a_side_with_no_groups_is_inconclusive() -> None:
    evidence = {**overlap(0, []), "test_groups": 0}
    assert verify("no_group_overlap", evidence)[0] == "inconclusive"


def test_class_shares_may_drift_by_one_row_on_a_small_test_side() -> None:
    settings = {"max_gap": 0.05}
    big = {"largest_gap": 0.06, "train_rows": 4000, "test_rows": 1000}
    assert verify("class_shares_kept", big, settings)[0] == "fail"
    # On 10 test rows one row is 10%: a drift that small is the split's rounding.
    small = {"largest_gap": 0.08, "train_rows": 40, "test_rows": 10}
    assert verify("class_shares_kept", small, settings)[0] == "pass"


def test_a_temporal_split_says_it_leaves_no_gap_at_the_cutoff() -> None:
    d = decide(METHOD, decisions=INDEPENDENT, bound=[TARGET, "common.event_time"])
    assert "no gap" in d["reason"]
