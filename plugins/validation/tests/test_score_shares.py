"""How far each class's share moved between the train and test rows, measured with the final
score, the one step that may read the test labels (ADR-0064)."""

import json
from pathlib import Path

import polars as pl
import pytest

from sprisk_validation.score_shares import class_shares
from sprisk_workers.manifests import load_operators


def test_the_largest_gap_in_a_class_s_share_names_the_class() -> None:
    train = pl.DataFrame({"y": ["a"] * 75 + ["b"] * 25})
    test = pl.DataFrame({"y": ["a"] * 10 + ["b"] * 10})
    assert class_shares(train, test, target="y") == {
        "largest_gap": pytest.approx(0.25),
        "class": "a",
        "drifted": True,
        "train_rows": 100,
        "labelled_test_rows": 20,
    }


def test_a_tie_names_the_first_class_by_its_whole_number() -> None:
    found = class_shares(pl.DataFrame({"y": [1, 1]}), pl.DataFrame({"y": [1, 2]}), target="y")
    assert found["largest_gap"] == pytest.approx(0.5)
    assert found["class"] == "1"


def test_a_gap_one_row_can_make_is_rounding_not_drift() -> None:
    # On 10 labelled test rows one row moves a share by 10%.
    train = pl.DataFrame({"y": ["a"] * 72 + ["b"] * 28})
    test = pl.DataFrame({"y": ["a"] * 8 + ["b"] * 2 + [None] * 5})
    found = class_shares(train, test, target="y")
    assert found["largest_gap"] == pytest.approx(0.08)
    assert found["labelled_test_rows"] == 10
    assert found["drifted"] is False


def test_an_empty_side_is_refused_rather_than_measured_as_no_gap() -> None:
    with pytest.raises(ValueError, match="test rows are empty"):
        class_shares(
            pl.DataFrame({"y": [1, 2]}), pl.DataFrame({"y": []}, schema={"y": pl.Int64}), target="y"
        )


def test_rows_with_no_label_are_left_out_of_the_shares() -> None:
    found = class_shares(
        pl.DataFrame({"y": ["a", "b", None]}), pl.DataFrame({"y": ["a", "b"]}), target="y"
    )
    assert found["largest_gap"] == pytest.approx(0.0)
    assert found["drifted"] is False


def test_the_worker_stores_the_shares_as_the_step_s_metrics(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.validation.class_shares@2.0.0"]
    paths = {}
    for port, rows in (("train", ["a", "b"]), ("test", ["b", "b"])):
        paths[port] = tmp_path / f"{port}.parquet"
        pl.DataFrame({"y": rows}).write_parquet(paths[port])
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    (written,) = step.run({"target": "y"}, paths, out_dir)

    assert written.port == "metrics"
    assert json.loads(written.path.read_text())["class"] == "a"
