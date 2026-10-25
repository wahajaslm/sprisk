import json
from pathlib import Path

import polars as pl

from sprisk_profile.html_text import html_text
from sprisk_workers.manifests import load_operators

KIND = "data.html_text"


def test_feature_text_holding_tags_or_entities_is_named_to_strip() -> None:
    data = pl.DataFrame(
        {
            "description": ["<p>Red shoe</p>", "caf&eacute; mug", None, "plain"],
            "title": ["a", "b", "c", "d"],
            "n": [1, 2, 3, 4],
        }
    )
    assert html_text(data)[KIND] == {"columns": ["description"], "held": []}


def test_the_item_and_time_columns_are_held_as_they_are() -> None:
    data = pl.DataFrame({"sku": ["<b>a</b>", "b"], "body": ["x<br />y", "z"]})
    assert html_text(data, item="sku")[KIND] == {"columns": ["body"], "held": ["sku"]}


def test_the_worker_never_hands_it_the_target(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.html_text@1.0.0"]
    source = tmp_path / "data.parquet"
    pl.DataFrame({"label": ["<b>a</b>", "b"], "body": ["x<br />y", "z"]}).write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({"target": "label"}, {"data": source}, out)}
    found = json.loads(written["evidence"].path.read_text())[KIND]
    assert found == {"columns": ["body"], "held": []}


def test_the_worker_stores_the_evidence(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.html_text@1.0.0"]
    source = tmp_path / "data.parquet"
    pl.DataFrame({"body": ["x<br />y", "z"]}).write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({}, {"data": source}, out)}
    assert json.loads(written["evidence"].path.read_text())[KIND]["columns"] == ["body"]
