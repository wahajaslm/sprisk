from pathlib import Path

import polars as pl
import pytest
from conftest import WriteParquet
from split_runs import run_split

from sprisk_validation.random_split import random_split
from sprisk_workers.errors import OperatorError

IDS = pl.DataFrame({"id": list(range(100))})


def test_random_split_partitions_rows_by_fraction(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    train, test = run_split(
        random_split, {"test_fraction": 0.2, "seed": 7}, write_parquet, out_dir, IDS
    )
    assert test.height == 20
    assert sorted(train["id"].to_list() + test["id"].to_list()) == list(range(100))


def test_random_split_is_reproducible_by_seed(write_parquet: WriteParquet, out_dir: Path) -> None:
    params: dict[str, object] = {"test_fraction": 0.2, "seed": 7}
    _, a = run_split(random_split, params, write_parquet, out_dir, IDS)
    _, b = run_split(random_split, params, write_parquet, out_dir, IDS)
    assert a["id"].to_list() == b["id"].to_list()


def test_random_split_that_leaves_test_empty_is_an_error(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    params: dict[str, object] = {"test_fraction": 0.1, "seed": 1}
    with pytest.raises(OperatorError) as e:
        run_split(random_split, params, write_parquet, out_dir, pl.DataFrame({"id": [1]}))
    assert e.value.code == "empty_split"
