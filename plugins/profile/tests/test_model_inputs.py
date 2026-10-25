import json
from datetime import date
from pathlib import Path

import polars as pl

from sprisk_profile.model_inputs import model_inputs
from sprisk_workers.manifests import load_operators

TEXT = "features.free_text"
DATES = "features.dates"


def titles(rows: int) -> list[str]:
    return [f"red shoe size {i}" for i in range(rows)]


def test_text_with_many_values_mostly_of_several_words_is_free_text() -> None:
    data = pl.DataFrame(
        {"title": titles(40), "colour": ["red", "blue"] * 20, "city": ["New York"] * 40}
    )
    assert model_inputs(data, target="label")[TEXT] == {
        "columns": ["title"],
        "categories": ["colour", "city"],
        "empty": [],
    }


def test_a_text_column_with_no_values_is_named_empty() -> None:
    data = pl.DataFrame({"note": pl.Series([None, None], dtype=pl.String)})
    assert model_inputs(data, target="label")[TEXT] == {
        "columns": [],
        "categories": [],
        "empty": ["note"],
    }


def test_date_and_datetime_columns_are_named() -> None:
    data = pl.DataFrame(
        {"day": [date(2026, 1, 1), date(2026, 1, 2)], "n": [1, 2], "s": ["a", "b"]}
    ).with_columns(pl.col("day").cast(pl.Datetime).alias("at"))
    assert model_inputs(data, target="label")[DATES] == {"columns": ["day", "at"]}


def test_the_worker_reads_the_train_rows_without_the_target(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.model_inputs@1.0.0"]
    source = tmp_path / "train.parquet"
    pl.DataFrame({"title": titles(40), "label": titles(40)}).write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({"target": "label"}, {"train": source}, out)}
    found = json.loads(written["evidence"].path.read_text())
    assert found[TEXT]["columns"] == ["title"]


CATEGORIES = "features.categories"
GAPS = "features.gaps"
ENCODING = "features.encoding"


def test_categories_too_many_for_one_hot_are_named_to_group_unless_identifiers() -> None:
    rows = 100
    data = pl.DataFrame(
        {
            "brand": [f"b{i % 30}" for i in range(rows)],
            "sku": [f"s{i}" for i in range(rows)],
            "colour": ["red", "blue"] * 50,
        }
    )
    assert model_inputs(data, target="label")[CATEGORIES] == {
        "grouped": ["brand"],
        "identifiers": ["sku"],
    }


def test_gaps_are_named_with_the_fill_their_numbers_need() -> None:
    data = pl.DataFrame(
        {
            "price": [1.0, 2.0, None, 100.0, 3.0],
            "kind": ["a", None, "b", "a", "b"],
            "note": [None, None, None, None, "x"],
            "ok": [1, 2, 3, 4, 5],
        }
    )
    assert model_inputs(data, target="label")[GAPS] == {
        "columns": ["price", "kind"],
        "method": "median",
        "mostly_empty": ["note"],
        "unfillable": [],
    }


def test_a_symmetric_number_is_filled_with_its_mean_and_a_date_cannot_be_filled() -> None:
    data = pl.DataFrame(
        {"x": [1.0, 2.0, None, 3.0], "day": [date(2026, 1, 1), None, date(2026, 1, 3), None]}
    )
    found = model_inputs(data, target="label")[GAPS]
    assert (found["columns"], found["method"], found["unfillable"]) == (["x"], "mean", ["day"])


def test_categories_are_split_by_whether_one_hot_takes_them() -> None:
    rows = 40
    data = pl.DataFrame(
        {
            "colour": ["red", "blue"] * 20,
            "brand": [f"b{i % 20}" for i in range(rows)],
            "rate": [1, 2, 3, 4] * 10,
            "count": list(range(rows)),
            "flag": [True, False] * 20,
        }
    )
    assert model_inputs(data, target="label")[ENCODING] == {
        "few": ["colour", "flag"],
        "many": ["brand"],
        "codes": ["rate"],
    }
