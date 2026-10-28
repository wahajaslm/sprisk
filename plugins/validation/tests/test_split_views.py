import json
from pathlib import Path

import polars as pl
import pytest

from sprisk_workers.manifests import load_operators

RANDOM, STRATIFIED, GROUP, TEMPORAL = (
    f"sprisk.validation.{name}@1.0.0"
    for name in ("random_split", "stratified_split", "group_split", "temporal_split")
)


@pytest.mark.parametrize(
    ("operator", "params", "title", "y"),
    [
        (RANDOM, {}, "Rows on each side", [8, 2]),
        (STRATIFIED, {"stratify": "y"}, "Rows on each side", [8, 2]),
        (GROUP, {"group_column": "g"}, "Items on each side", [4, 1]),
        (TEMPORAL, {"time_column": "t"}, "Rows over time, with the cutoff", None),
    ],
)
def test_each_split_draws_its_sides_on_its_node(
    tmp_path: Path, operator: str, params: dict[str, str], title: str, y: list[int] | None
) -> None:
    step = load_operators(Path(__file__).parents[2])[operator]
    rows = pl.DataFrame(
        {
            "g": [f"item{i // 2}" for i in range(10)],
            "t": list(range(10)),
            "y": [i % 2 for i in range(10)],
        }
    )
    rows.write_parquet(tmp_path / "data.parquet")
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    written = {o.port: o for o in step.run(params, {"data": tmp_path / "data.parquet"}, out_dir)}

    [figure] = json.loads(written["figures"].path.read_text())["items"]
    assert (figure["library"], figure["title"]) == ("plotly", title)
    if y is not None:
        assert json.loads(figure["content"])["data"][0]["y"] == y


def test_the_time_view_bins_the_rows_and_marks_the_cutoff(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])[TEMPORAL]
    pl.DataFrame({"t": list(range(200))}).write_parquet(tmp_path / "data.parquet")
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    written = {
        o.port: o
        for o in step.run({"time_column": "t"}, {"data": tmp_path / "data.parquet"}, out_dir)
    }

    [figure] = json.loads(written["figures"].path.read_text())["items"]
    drawn = json.loads(figure["content"])
    train, test = (pl.read_parquet(written[side].path) for side in ("train", "test"))
    assert [len(bars["x"]) <= 30 for bars in drawn["data"]] == [True, True]
    assert [sum(bars["y"]) for bars in drawn["data"]] == [train.height, test.height]
    assert drawn["layout"]["shapes"][0]["x0"] == test["t"].min()
