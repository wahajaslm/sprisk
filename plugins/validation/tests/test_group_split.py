from collections.abc import Callable
from typing import Any

import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from sprisk_validation.group_split import as_code, group_split
from sprisk_workers.notebook_code import read_settings


def test_group_split_is_reproducible_and_keeps_entities_apart() -> None:
    data = pl.DataFrame({"order_id": [1, 1, 2, 2, 3, 3, 4, 4], "x": range(8)})
    first = group_split(data, "order_id", 0.5, 7)
    second = group_split(data, "order_id", 0.5, 7)
    assert first["test"].equals(second["test"])
    assert set(first["train"]["order_id"]).isdisjoint(first["test"]["order_id"])


@pytest.mark.parametrize(
    "data,error",
    [
        (pl.DataFrame({"g": [1, None, 2]}), "missing values"),
        (pl.DataFrame({"g": [1, 1]}), "at least two"),
    ],
)
def test_group_split_rejects_groups_it_cannot_separate(data: pl.DataFrame, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        group_split(data, "g", 0.5, 1)


def test_plain_code_splits_the_rows_as_the_step_does() -> None:
    data = pl.DataFrame({"order_id": [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], "x": range(10)})
    settings: dict[str, Any] = {"group_column": "order_id", "test_fraction": 0.4, "seed": 7}
    namespace: dict[str, Any] = {"rows": data}
    exec(as_code(settings, {"data": "rows"}, {"train": "fit_rows", "test": "held_out"}), namespace)
    step = group_split(data, **settings)
    assert namespace["fit_rows"].equals(step["train"])
    assert namespace["held_out"].equals(step["test"])


@settings(max_examples=40, deadline=None)
@given(name=st.text(min_size=1))
def test_column_names_never_become_code(code_shape: Callable[[str], str], name: str) -> None:
    def code(column: str) -> str:
        values = {"group_column": column, "test_fraction": 0.4, "seed": 7}
        return as_code(values, {"data": "rows"}, {"train": "a", "test": "b"})

    assert code_shape(code(name)) == code_shape(code("order_id"))


def test_an_edited_seed_in_the_code_is_read_back_as_the_setting() -> None:
    values = {"group_column": "order_id", "test_fraction": 0.4, "seed": 7}
    names = ({"data": "rows"}, {"train": "a", "test": "b"})
    edited = as_code(values, *names).replace("random_state=7", "random_state=8")
    assert read_settings(as_code, values, *names, edited) == {**values, "seed": 8}
