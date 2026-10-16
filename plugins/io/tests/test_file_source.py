import inspect
from pathlib import Path

import polars as pl
import pytest

import sprisk_io.file_source as module
from sprisk_io.file_source import file_source


def test_csv_is_read_as_a_table(tmp_path: Path) -> None:
    csv = tmp_path / "d.csv"
    csv.write_text("a,b\n1,x\n2,y\n")
    assert file_source(str(csv), "csv").to_dicts() == [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]


def test_na_marks_a_missing_value_so_numbers_stay_numbers(tmp_path: Path) -> None:
    csv = tmp_path / "d.csv"
    csv.write_text("mass,sex\n3750,MALE\nNA,NA\n")
    df = file_source(str(csv), "csv")
    assert df.schema["mass"] == pl.Int64
    assert df.to_dicts() == [{"mass": 3750, "sex": "MALE"}, {"mass": None, "sex": None}]


def test_which_text_means_missing_can_be_chosen(tmp_path: Path) -> None:
    csv = tmp_path / "d.csv"
    csv.write_text("x\n1\n?\n")
    assert file_source(str(csv), "csv", missing_values=["?"])["x"].to_list() == [1, None]


def test_parquet_is_read_as_a_table(tmp_path: Path) -> None:
    src = tmp_path / "d.parquet"
    pl.DataFrame({"a": [1]}).write_parquet(src)
    assert file_source(str(src), "parquet").to_dicts() == [{"a": 1}]


def test_missing_file_is_an_error_naming_it(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no file at .*nope.csv"):
        file_source(str(tmp_path / "nope.csv"), "csv")


def test_the_code_imports_nothing_from_sprisk() -> None:
    source = inspect.getsource(module)
    assert "from sprisk" not in source and "import sprisk" not in source
