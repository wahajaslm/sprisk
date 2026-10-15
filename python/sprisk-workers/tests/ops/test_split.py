from pathlib import Path

import polars as pl
import pytest
from conftest import WriteParquet

from sprisk_workers.errors import OperatorError
from sprisk_workers.ops.split import random_split, temporal_split
from sprisk_workers.serve import OperatorFn

IDS = pl.DataFrame({"id": list(range(100))})


def split(
    fn: OperatorFn, params: dict[str, object], write: WriteParquet, out_dir: Path, df: pl.DataFrame
) -> tuple[pl.DataFrame, pl.DataFrame]:
    outs = {o.port: pl.read_parquet(o.path) for o in fn(params, {"data": write("d", df)}, out_dir)}
    return outs["train"], outs["test"]


def test_random_split_partitions_rows_by_fraction(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    train, test = split(
        random_split, {"test_fraction": 0.2, "seed": 7}, write_parquet, out_dir, IDS
    )
    assert test.height == 20
    assert sorted(train["id"].to_list() + test["id"].to_list()) == list(range(100))


def test_random_split_is_reproducible_by_seed(write_parquet: WriteParquet, out_dir: Path) -> None:
    params: dict[str, object] = {"test_fraction": 0.2, "seed": 7}
    _, a = split(random_split, params, write_parquet, out_dir, IDS)
    _, b = split(random_split, params, write_parquet, out_dir, IDS)
    assert a["id"].to_list() == b["id"].to_list()


def test_temporal_split_puts_all_train_strictly_before_test(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    df = pl.DataFrame({"t": [5, 1, 2, 2, 3, 3, 4, 4, 1, 5]})
    params: dict[str, object] = {"time_column": "t", "test_fraction": 0.3}
    train, test = split(temporal_split, params, write_parquet, out_dir, df)
    assert train["t"].max() < test["t"].min()  # type: ignore[operator]
    assert train.height + test.height == 10


@pytest.mark.parametrize(
    ("df", "code"),
    [
        (pl.DataFrame({"t": [1, None, 3, 4]}), "null_time_values"),
        (pl.DataFrame({"other": [1, 2]}), "missing_column"),
        (pl.DataFrame({"t": [1, 1, 1, 1]}), "empty_split"),
    ],
)
def test_temporal_split_rejects_bad_data(
    df: pl.DataFrame, code: str, write_parquet: WriteParquet, out_dir: Path
) -> None:
    params: dict[str, object] = {"time_column": "t", "test_fraction": 0.5}
    with pytest.raises(OperatorError) as e:
        split(temporal_split, params, write_parquet, out_dir, df)
    assert e.value.code == code


def test_random_split_that_leaves_test_empty_is_an_error(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    params: dict[str, object] = {"test_fraction": 0.1, "seed": 1}
    with pytest.raises(OperatorError) as e:
        split(random_split, params, write_parquet, out_dir, pl.DataFrame({"id": [1]}))
    assert e.value.code == "empty_split"
