import json
from pathlib import Path

import polars as pl

from sprisk_profile.column_roles import column_roles
from sprisk_workers.manifests import load_operators

IDS = "data.identifiers"
DUPLICATES = "data.duplicate_rows"


def table(rows: int = 6) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "row_id": list(range(rows)),
            "sku": [f"A{i}" for i in range(rows)],
            "title": [f"red shoe {i}" for i in range(rows)],
            "price": [float(i) for i in range(rows)],
            "colour": ["red", "blue"] * (rows // 2),
        }
    )


def test_whole_numbers_and_one_word_codes_unique_in_every_row_are_identifiers() -> None:
    found = column_roles(table())[IDS]
    assert found["columns"] == ["row_id", "sku"]
    assert found["rows"] == 6
    assert found["features_left"] == 3


def test_the_item_and_time_columns_are_never_identifiers() -> None:
    found = column_roles(table(), item="sku", time="row_id")[IDS]
    assert found["columns"] == []
    assert found["features_left"] == 3


def test_no_feature_left_is_counted() -> None:
    # The worker has already dropped the target.
    data = pl.DataFrame({"row_id": [1, 2, 3]})
    found = column_roles(data, target="label")[IDS]
    assert found["columns"] == ["row_id"]
    assert found["features_left"] == 0


def test_a_copied_row_repeats_its_identifier_but_is_still_counted_as_a_copy() -> None:
    data = pl.DataFrame(
        {"row_id": [1, 2, 3, 4], "price": [1.0, 1.0, 2.0, 3.0], "colour": ["r", "r", "b", "g"]}
    )
    found = column_roles(data)
    assert found[IDS]["columns"] == ["row_id"]
    assert found[DUPLICATES] == {"rows": 4, "duplicates": 1}


def test_without_identifiers_rows_are_compared_in_every_column() -> None:
    data = pl.DataFrame({"price": [1.0, 1.0, 2.0, 3.0, 4.0], "colour": ["r", "r", "b", "b", "g"]})
    assert column_roles(data)[DUPLICATES] == {"rows": 5, "duplicates": 1}


def test_the_worker_fills_only_the_bound_columns(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.column_roles@1.0.0"]
    source = tmp_path / "data.parquet"
    table().write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({"target": "colour"}, {"data": source}, out)}
    found = json.loads(written["evidence"].path.read_text())
    assert sorted(found) == [DUPLICATES, IDS]
    # title and price; the target is not a feature.
    assert found[IDS]["features_left"] == 2
