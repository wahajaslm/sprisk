import json
from pathlib import Path

import polars as pl
import pytest

from sprisk_validation.split_evidence import class_shares, group_overlap
from sprisk_workers.manifests import load_operators

OVERLAP = "evaluation.group_overlap"
SHARES = "evaluation.class_shares"


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


def test_the_largest_gap_in_a_class_s_share_between_train_and_test() -> None:
    train = pl.DataFrame({"y": ["a", "a", "a", "b"]})
    test = pl.DataFrame({"y": ["a", "b"]})
    found = class_shares(train, test, target="y")[SHARES]
    assert found == {"largest_gap": pytest.approx(0.25), "train_rows": 4, "test_rows": 2}


def test_a_class_only_one_side_has_counts_its_whole_share() -> None:
    found = class_shares(pl.DataFrame({"y": [1, 1]}), pl.DataFrame({"y": [1, 2]}), target="y")[
        SHARES
    ]
    assert found["largest_gap"] == pytest.approx(0.5)


def test_a_missing_column_is_refused() -> None:
    with pytest.raises(ValueError, match="no column g"):
        group_overlap(pl.DataFrame({"x": [1]}), pl.DataFrame({"x": [1]}), group_column="g")


def test_an_empty_side_is_refused_rather_than_measured_as_no_gap() -> None:
    with pytest.raises(ValueError, match="test rows are empty"):
        class_shares(
            pl.DataFrame({"y": [1, 2]}), pl.DataFrame({"y": []}, schema={"y": pl.Int64}), target="y"
        )


def test_rows_with_no_label_are_left_out_of_the_shares() -> None:
    found = class_shares(
        pl.DataFrame({"y": ["a", "b", None]}), pl.DataFrame({"y": ["a", "b"]}), target="y"
    )[SHARES]
    assert found["largest_gap"] == pytest.approx(0.0)


@pytest.mark.parametrize(
    ("operator", "params", "kind"),
    [
        ("sprisk.validation.group_overlap@1.0.0", {"group_column": "g"}, OVERLAP),
        ("sprisk.validation.class_shares@1.0.0", {"target": "g"}, SHARES),
    ],
)
def test_the_worker_stores_one_evidence_set_on_the_evidence_port(
    tmp_path: Path, operator: str, params: dict[str, str], kind: str
) -> None:
    step = load_operators(Path(__file__).parents[2])[operator]
    paths = {}
    for port, rows in (("train", ["a", "b"]), ("test", ["b", "c"])):
        paths[port] = tmp_path / f"{port}.parquet"
        pl.DataFrame({"g": rows}).write_parquet(paths[port])
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    written = {o.port: o for o in step.run(params, paths, out_dir)}

    assert list(json.loads(written["evidence"].path.read_text())) == [kind]
