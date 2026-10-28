"""How rows are divided into training and test so the score is fair (ADR-0063, ADR-0071): by
time when a time column orders them, by item when rows repeat an item, else at random. A broken
promise falls back only where a fair stand-in exists."""

import pytest
import yaml
from method_harness import PACKS, decide

METHOD = "supervised/split_method"
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


REPEATED_ROWS = "12 test rows have the same features as a train row."


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_a_random_split_that_broke_its_promise_asks_for_the_item_column(task: str) -> None:
    ruled = {"stratified_random": REPEATED_ROWS, "simple_random": REPEATED_ROWS}
    d = decide(METHOD, task=task, decisions=INDEPENDENT, bound=[TARGET], ruled_out=ruled)
    assert (d["outcome"], d["option"]) == ("ask", "item_groups")
    assert REPEATED_ROWS in d["reason"]
    assert d["reason"].endswith("It needs the item identity column named.")


def test_an_item_split_that_broke_its_promise_leaves_no_fair_split() -> None:
    overlap = "2 items have rows in both train and test: a, b"
    d = decide(
        METHOD,
        decisions=INDEPENDENT,
        bound=[TARGET, "common.item_identity"],
        ruled_out={"item_groups": overlap},
    )
    assert d["answer"] == "refused"
    assert overlap in d["error"]


def test_a_time_split_that_broke_its_promise_is_not_traded_for_item_groups() -> None:
    late = "3 test rows are not later than 2024-01-01."
    d = decide(
        METHOD,
        decisions=INDEPENDENT,
        bound=[TARGET, "common.event_time", "common.item_identity"],
        ruled_out={"temporal": late},
    )
    assert d["answer"] == "refused"
    assert late in d["error"]
