import json
from pathlib import Path

import polars as pl
import pytest

from sprisk_profile.target_shape import target_shape
from sprisk_workers.manifests import load_operators

KIND = "target.shape"


def test_product_codes_are_whole_numbers_with_their_rarest_share() -> None:
    codes = [10] * 50 + [2280] * 30 + [40] * 20
    found = target_shape(pl.DataFrame({"code": codes}), target="code")[KIND]
    assert found == {
        "rows": 100,
        "distinct": 3,
        "numeric": True,
        "whole_numbers": True,
        "rarest_share": pytest.approx(0.2),
    }


def test_the_train_rows_are_counted_on_their_own_for_the_model_shortlist() -> None:
    found = target_shape(pl.DataFrame({"y": ["yes", "no", None]}), target="y")
    assert found["data.train_rows"] == {"rows": 3}


def test_a_measured_quantity_is_numeric_but_not_whole() -> None:
    found = target_shape(pl.DataFrame({"y": [0.5, 1.25, 3.0, 3.0]}), target="y")[KIND]
    assert (found["numeric"], found["whole_numbers"], found["distinct"]) == (True, False, 3)


def test_text_labels_are_neither_numeric_nor_whole() -> None:
    found = target_shape(pl.DataFrame({"y": ["yes", "no", "no", None]}), target="y")[KIND]
    assert (found["numeric"], found["whole_numbers"]) == (False, False)
    # Rows with no label belong to no class.
    assert found["rarest_share"] == pytest.approx(1 / 3)


def test_a_missing_target_or_no_labels_is_refused() -> None:
    with pytest.raises(ValueError, match="no column y"):
        target_shape(pl.DataFrame({"x": [1]}), target="y")
    with pytest.raises(ValueError, match="no labels"):
        target_shape(pl.DataFrame({"y": [None, None]}, schema={"y": pl.Int64}), target="y")


def test_the_worker_stores_one_evidence_set(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.target_shape@1.0.0"]
    source = tmp_path / "train.parquet"
    pl.DataFrame({"y": [1, 2, 2]}).write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({"target": "y"}, {"train": source}, out)}
    assert list(json.loads(written["evidence"].path.read_text())) == [KIND, "data.train_rows"]
