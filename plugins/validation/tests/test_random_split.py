import polars as pl
import pytest

from sprisk_validation.random_split import random_split
from sprisk_workers.notebook_code import source_cell

IDS = pl.DataFrame({"id": list(range(100))})
NAMES = ({"data": "rows"}, {"train": "fit_rows", "test": "held_out"})


def test_random_split_partitions_rows_by_fraction() -> None:
    train, test = random_split(IDS, test_fraction=0.2, seed=7)
    assert test.height == 20
    assert sorted(train["id"].to_list() + test["id"].to_list()) == list(range(100))


def test_random_split_is_reproducible_by_seed() -> None:
    _, a = random_split(IDS, test_fraction=0.2, seed=7)
    _, b = random_split(IDS, test_fraction=0.2, seed=7)
    assert a["id"].to_list() == b["id"].to_list()


def test_random_split_that_leaves_test_empty_is_an_error() -> None:
    with pytest.raises(ValueError, match="1 train and 0 test rows"):
        random_split(pl.DataFrame({"id": [1]}), test_fraction=0.1, seed=1)


def test_plain_code_splits_the_rows_as_the_step_does() -> None:
    settings = {"test_fraction": 0.25, "seed": 3}
    namespace: dict[str, object] = {"rows": IDS}
    exec(source_cell(random_split)(settings, *NAMES), namespace)
    train, test = random_split(IDS, **settings)  # type: ignore[arg-type]
    assert namespace["fit_rows"].equals(train)  # type: ignore[attr-defined]
    assert namespace["held_out"].equals(test)  # type: ignore[attr-defined]
