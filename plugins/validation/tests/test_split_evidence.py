import json
from pathlib import Path

import polars as pl
import pytest

from sprisk_validation.split_evidence import group_overlap, row_overlap, time_order
from sprisk_workers.manifests import load_operators

OVERLAP = "evaluation.group_overlap"
ROWS = "evaluation.row_overlap"
ORDER = "evaluation.time_order"


def test_groups_on_both_sides_are_counted_and_named() -> None:
    train = pl.DataFrame({"item_group": [1, 1, 2, 3]})
    test = pl.DataFrame({"item_group": [3, 4, 2]})
    found = group_overlap(train, test, group_column="item_group")
    assert found == {
        OVERLAP: {
            "overlapping": 2,
            "overlapping_groups": ["2", "3"],
            "train_groups": 3,
            "test_groups": 3,
        }
    }


def test_groups_kept_apart_overlap_nowhere() -> None:
    found = group_overlap(
        pl.DataFrame({"g": ["a", "b"]}), pl.DataFrame({"g": ["c"]}), group_column="g"
    )
    assert found[OVERLAP]["overlapping"] == 0
    assert found[OVERLAP]["overlapping_groups"] == []


def test_only_the_first_twenty_overlapping_groups_are_named() -> None:
    both = pl.DataFrame({"g": list(range(50))})
    found = group_overlap(both, both, group_column="g")[OVERLAP]
    assert found["overlapping"] == 50
    assert len(found["overlapping_groups"]) == 20


def test_identical_rows_on_both_sides_are_counted_without_the_target() -> None:
    train = pl.DataFrame({"title": ["lamp", "desk", "lamp"], "y": [1, 2, 1]})
    # The second test row is the first train row's features with another label.
    test = pl.DataFrame({"title": ["chair", "lamp"], "y": [3, 9]})
    found = row_overlap(train, test, target="y")[ROWS]
    assert found == {"in_both": 1, "train_rows": 3, "test_rows": 2}


def test_rows_that_differ_in_any_feature_are_not_in_both() -> None:
    train = pl.DataFrame({"title": ["lamp"], "price": [10], "y": [1]})
    test = pl.DataFrame({"title": ["lamp"], "price": [11], "y": [1]})
    assert row_overlap(train, test, target="y")[ROWS]["in_both"] == 0


def test_a_table_with_only_the_target_has_no_rows_to_compare() -> None:
    only = pl.DataFrame({"y": [1, 2]})
    with pytest.raises(ValueError, match="no feature columns"):
        row_overlap(only, only, target="y")


def test_test_rows_not_later_than_the_last_train_row_are_counted() -> None:
    train = pl.DataFrame({"day": [1, 2, 5]})
    test = pl.DataFrame({"day": [5, 4, 7]})
    found = time_order(train, test, time_column="day")[ORDER]
    assert found == {
        "not_later_test_rows": 2,
        "latest_train": "5",
        "earliest_test": "4",
        "train_rows": 3,
        "test_rows": 3,
    }


def test_a_tie_with_the_last_train_row_is_not_later() -> None:
    found = time_order(pl.DataFrame({"day": [1, 5]}), pl.DataFrame({"day": [5, 6]}), "day")[ORDER]
    assert found["not_later_test_rows"] == 1


def test_a_row_with_no_time_is_refused_rather_than_ordered() -> None:
    with pytest.raises(ValueError, match="1 test rows have no day"):
        time_order(pl.DataFrame({"day": [1, 2]}), pl.DataFrame({"day": [3, None]}), "day")
    with pytest.raises(ValueError, match="1 train rows have no day"):
        time_order(pl.DataFrame({"day": [None, 2]}), pl.DataFrame({"day": [3]}), "day")


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

    assert list(json.loads(written["evidence"].path.read_text())) == [kind]
