"""How rows are divided into training and test so the score is fair (ADR-0063): by time when
a time column orders them, by item when rows repeat an item, else at random."""

import importlib.util
from collections.abc import Mapping

import pytest
import yaml
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


def test_a_test_row_with_the_features_of_a_train_row_fails_the_row_promise() -> None:
    verdict, reason = verify("no_row_in_both", {"in_both": 4, "train_rows": 80, "test_rows": 20})
    assert verdict == "fail"
    assert reason.startswith("4 test rows have the same features as a train row")
    assert verify("no_row_in_both", {"in_both": 0, "train_rows": 80, "test_rows": 20})[0] == "pass"


def test_a_test_row_not_later_than_the_train_rows_fails_the_time_promise() -> None:
    order = {"latest_train": "2024-05-01", "earliest_test": "2024-05-01", "train_rows": 80}
    tied = {**order, "not_later_test_rows": 2, "test_rows": 20}
    verdict, reason = verify("test_after_train", tied)
    assert verdict == "fail"
    assert "2 test rows are not later than 2024-05-01" in reason
    later = {**order, "earliest_test": "2024-05-02", "not_later_test_rows": 0, "test_rows": 20}
    assert verify("test_after_train", later)[0] == "pass"


@pytest.mark.parametrize(
    "option", ["temporal", "item_groups", "stratified_random", "simple_random"]
)
def test_every_split_option_promises_something(option: str) -> None:
    manifest = yaml.safe_load((PACKS / "supervised/methods/split_method/method.yaml").read_text())
    (chosen,) = [o for o in manifest["options"] if o["id"] == option]
    assert chosen["verify"], option
    assert "class_shares_kept" not in manifest["verifications"]


def test_a_temporal_split_says_it_leaves_no_gap_at_the_cutoff() -> None:
    d = decide(METHOD, decisions=INDEPENDENT, bound=[TARGET, "common.event_time"])
    assert "no gap" in d["reason"]
