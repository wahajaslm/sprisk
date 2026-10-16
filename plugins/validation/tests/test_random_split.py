import polars as pl
import pytest

from sprisk_validation.random_split import random_split

IDS = pl.DataFrame({"id": list(range(100))})


def test_random_split_partitions_rows_by_fraction() -> None:
    out = random_split(IDS, test_fraction=0.2, seed=7)
    assert out["test"].height == 20
    assert sorted(out["train"]["id"].to_list() + out["test"]["id"].to_list()) == list(range(100))


def test_random_split_is_reproducible_by_seed() -> None:
    a = random_split(IDS, test_fraction=0.2, seed=7)["test"]
    b = random_split(IDS, test_fraction=0.2, seed=7)["test"]
    assert a["id"].to_list() == b["id"].to_list()


def test_random_split_that_leaves_test_empty_is_an_error() -> None:
    with pytest.raises(ValueError, match="1 train and 0 test rows"):
        random_split(pl.DataFrame({"id": [1]}), test_fraction=0.1, seed=1)
