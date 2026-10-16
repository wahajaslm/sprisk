from pathlib import Path

import polars as pl
import pytest
from conftest import WriteParquet
from fit_runs import run_fit

from sprisk_clean.scale import scale
from sprisk_workers.errors import OperatorError


def test_missing_column_in_either_table_is_an_error(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    train = pl.DataFrame({"x": [1.0, 2.0]})
    test = pl.DataFrame({"z": [1.0]})
    with pytest.raises(OperatorError) as e:
        run_fit(scale, {"columns": ["x"], "method": "min_max"}, train, test, write_parquet, out_dir)
    assert e.value.code == "missing_column"
