import json
from pathlib import Path

import polars as pl

from sprisk_profile.join_keys import join_keys
from sprisk_workers.manifests import load_operators

KIND = "data.join_keys"
ITEMS = pl.DataFrame({"unnamed_0": [0, 1, 2], "designation": ["a", "b", "c"]})


def test_one_shared_column_is_the_key_with_its_matches() -> None:
    codes = pl.DataFrame({"unnamed_0": [0, 1, 2], "prdtypecode": [10, 20, 20]})
    assert join_keys(ITEMS, codes)[KIND] == {
        "rows": 3,
        "shared": ["unnamed_0"],
        "key": "unnamed_0",
        "matched_rows": 3,
        "most_rows_per_key": 1,
    }


def test_several_shared_columns_name_no_key() -> None:
    other = pl.DataFrame({"unnamed_0": [0], "designation": ["a"]})
    found = join_keys(ITEMS, other)[KIND]
    assert (found["shared"], found["key"]) == (["unnamed_0", "designation"], "")


def test_the_worker_reads_the_other_table_when_it_is_connected(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.join_keys@1.0.0"]
    items, codes = tmp_path / "items.parquet", tmp_path / "codes.parquet"
    ITEMS.write_parquet(items)
    pl.DataFrame({"unnamed_0": [0, 1, 2], "prdtypecode": [10, 20, 20]}).write_parquet(codes)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({}, {"data": items, "other": codes}, out)}
    assert json.loads(written["evidence"].path.read_text())[KIND]["key"] == "unnamed_0"
