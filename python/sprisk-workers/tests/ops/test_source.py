from pathlib import Path

import polars as pl
import pytest

from sprisk_workers.errors import OperatorError
from sprisk_workers.ops.source import file_source
from sprisk_workers.output import PARQUET


def test_csv_becomes_parquet(tmp_path: Path, out_dir: Path) -> None:
    csv = tmp_path / "d.csv"
    csv.write_text("a,b\n1,x\n2,y\n")
    [out] = file_source({"path": str(csv), "format": "csv"}, {}, out_dir)
    assert out.port == "data"
    assert out.media_type == PARQUET
    assert pl.read_parquet(out.path).to_dicts() == [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]


def test_parquet_is_copied_as_parquet(tmp_path: Path, out_dir: Path) -> None:
    src = tmp_path / "d.parquet"
    pl.DataFrame({"a": [1]}).write_parquet(src)
    [out] = file_source({"path": str(src), "format": "parquet"}, {}, out_dir)
    assert pl.read_parquet(out.path).to_dicts() == [{"a": 1}]


def test_missing_file_is_an_operator_error(tmp_path: Path, out_dir: Path) -> None:
    with pytest.raises(OperatorError) as e:
        file_source({"path": str(tmp_path / "nope.csv"), "format": "csv"}, {}, out_dir)
    assert e.value.code == "source_not_found"
