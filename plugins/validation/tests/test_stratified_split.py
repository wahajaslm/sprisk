import polars as pl
import pytest

from sprisk_validation.stratified_split import stratified_split
from sprisk_workers.notebook_code import source_cell

DATA = pl.DataFrame({"id": list(range(100)), "y": ["a"] * 80 + ["b"] * 20})


def test_stratified_split_keeps_each_class_share_in_test() -> None:
    _, test = stratified_split(DATA, stratify="y", test_fraction=0.25, seed=3)
    counts = dict(test.group_by("y").len().iter_rows())
    assert counts == {"a": 20, "b": 5}


def test_stratify_on_a_column_with_missing_values_is_an_error() -> None:
    data = pl.DataFrame({"id": [1, 2, 3, 4], "y": ["a", None, "a", "b"]})
    with pytest.raises(ValueError, match="y has 1 missing"):
        stratified_split(data, stratify="y", test_fraction=0.5, seed=1)


def test_plain_code_splits_the_rows_as_the_step_does() -> None:
    settings = {"stratify": "y", "test_fraction": 0.25, "seed": 3}
    namespace: dict[str, object] = {"rows": DATA}
    names = ({"data": "rows"}, {"train": "fit_rows", "test": "held_out"})
    exec(source_cell(stratified_split)(settings, *names), namespace)
    train, test = stratified_split(DATA, **settings)  # type: ignore[arg-type]
    assert namespace["fit_rows"].equals(train)  # type: ignore[attr-defined]
    assert namespace["held_out"].equals(test)  # type: ignore[attr-defined]
