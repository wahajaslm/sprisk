import json
from pathlib import Path

import polars as pl
import pytest

from sprisk_validation.group_split import no_group_overlap
from sprisk_validation.random_split import no_row_in_both
from sprisk_validation.temporal_split import test_after_train as time_order_promise
from sprisk_workers.manifests import load_operators

OVERLAP = "evaluation.group_overlap"
ROWS = "evaluation.row_overlap"
ORDER = "evaluation.time_order"


def test_groups_on_both_sides_are_counted_named_and_fail() -> None:
    train = pl.DataFrame({"item_group": [1, 1, 2, 3]})
    test = pl.DataFrame({"item_group": [3, 4, 2]})
    found = no_group_overlap(train, test, group_column="item_group")
    assert found.evidence == {
        "overlapping": 2,
        "overlapping_groups": ["2", "3"],
        "train_groups": 3,
        "test_groups": 3,
    }
    assert (found.status, found.detail) == (
        "fail",
        "2 items have rows in both train and test: 2, 3",
    )


def test_groups_kept_apart_overlap_nowhere() -> None:
    found = no_group_overlap(
        pl.DataFrame({"g": ["a", "b"]}), pl.DataFrame({"g": ["c"]}), group_column="g"
    )
    assert found.evidence["overlapping"] == 0
    assert found.evidence["overlapping_groups"] == []
    assert (found.status, found.detail) == (
        "pass",
        "No item is in both sides (2 train, 1 test items).",
    )


def test_a_side_with_no_groups_is_inconclusive() -> None:
    empty = pl.DataFrame({"g": []}, schema={"g": pl.String})
    found = no_group_overlap(pl.DataFrame({"g": ["a"]}), empty, group_column="g")
    assert (found.status, found.detail) == ("inconclusive", "One side has no groups.")


def test_only_the_first_twenty_overlapping_groups_are_named() -> None:
    both = pl.DataFrame({"g": list(range(50))})
    found = no_group_overlap(both, both, group_column="g").evidence
    assert found["overlapping"] == 50
    assert len(found["overlapping_groups"]) == 20


def test_identical_rows_on_both_sides_are_counted_without_the_target() -> None:
    train = pl.DataFrame({"title": ["lamp", "desk", "lamp"], "y": [1, 2, 1]})
    # The second test row is the first train row's features with another label.
    test = pl.DataFrame({"title": ["chair", "lamp"], "y": [3, 9]})
    found = no_row_in_both(train, test, target="y")
    assert found.evidence == {"in_both": 1, "train_rows": 3, "test_rows": 2}
    assert found.status == "fail" and found.detail.startswith("1 test rows have the same features")


def test_rows_that_differ_in_any_feature_are_not_in_both() -> None:
    train = pl.DataFrame({"title": ["lamp"], "price": [10], "y": [1]})
    test = pl.DataFrame({"title": ["lamp"], "price": [11], "y": [1]})
    found = no_row_in_both(train, test, target="y")
    assert found.evidence["in_both"] == 0
    assert (found.status, found.detail) == (
        "pass",
        "No test row repeats a train row (1 test rows).",
    )


def test_a_table_with_only_the_target_has_no_rows_to_compare() -> None:
    only = pl.DataFrame({"y": [1, 2]})
    with pytest.raises(ValueError, match="no feature columns"):
        no_row_in_both(only, only, target="y")


def test_test_rows_not_later_than_the_last_train_row_are_counted() -> None:
    train = pl.DataFrame({"day": [1, 2, 5]})
    test = pl.DataFrame({"day": [5, 4, 7]})
    found = time_order_promise(train, test, time_column="day")
    assert (found.status, found.detail) == ("fail", "2 test rows are not later than 5.")
    assert found.evidence == {
        "not_later_test_rows": 2,
        "latest_train": "5",
        "earliest_test": "4",
        "train_rows": 3,
        "test_rows": 3,
    }


def test_a_tie_with_the_last_train_row_is_not_later() -> None:
    found = time_order_promise(pl.DataFrame({"day": [1, 5]}), pl.DataFrame({"day": [5, 6]}), "day")
    assert found.evidence["not_later_test_rows"] == 1


def test_a_row_with_no_time_is_refused_rather_than_ordered() -> None:
    with pytest.raises(ValueError, match="1 test rows have no day"):
        time_order_promise(pl.DataFrame({"day": [1, 2]}), pl.DataFrame({"day": [3, None]}), "day")
    with pytest.raises(ValueError, match="1 train rows have no day"):
        time_order_promise(pl.DataFrame({"day": [None, 2]}), pl.DataFrame({"day": [3]}), "day")


@pytest.mark.parametrize(
    ("operator", "params", "kind"),
    [
        ("sprisk.validation.group_overlap@1.0.0", {"group_column": "g"}, OVERLAP),
        ("sprisk.validation.time_order@1.0.0", {"time_column": "g"}, ORDER),
        ("sprisk.validation.row_overlap@1.0.0", {"target": "y"}, ROWS),
    ],
)
def test_the_worker_stores_one_evidence_set_on_the_evidence_port(
    tmp_path: Path, operator: str, params: dict[str, str], kind: str
) -> None:
    step = load_operators(Path(__file__).parents[2])[operator]
    paths = {}
    for port, rows in (("train", ["a", "b"]), ("test", ["b", "c"])):
        paths[port] = tmp_path / f"{port}.parquet"
        pl.DataFrame({"g": rows, "y": [1, 2]}).write_parquet(paths[port])
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    written = {o.port: o for o in step.run(params, paths, out_dir)}

    stored = json.loads(written["evidence"].path.read_text())
    assert list(stored) == [kind]
    assert stored[kind]["status"] in ("pass", "fail", "inconclusive") and stored[kind]["detail"]
