from collections.abc import Callable
from typing import Any

import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from sprisk_clean.scale import as_code, scale
from sprisk_workers.notebook_code import read_settings

TRAIN = pl.DataFrame({"x": [0.0, 10.0]})
TEST = pl.DataFrame({"x": [5.0, 20.0]})


def test_min_max_uses_the_train_range_so_test_can_leave_zero_to_one() -> None:
    out = scale(TRAIN, TEST, columns=["x"], method="min_max")
    assert out["train"]["x"].to_list() == [0.0, 1.0]
    assert out["test"]["x"].to_list() == [0.5, 2.0]


def test_z_score_uses_train_mean_and_std() -> None:
    out = scale(TRAIN, TEST, columns=["x"], method="z_score")
    assert out["train"]["x"].mean() == pytest.approx(0.0)
    assert out["test"]["x"].to_list() == pytest.approx([0.0, 15 / 5.0])


def test_constant_train_column_is_an_error() -> None:
    with pytest.raises(ValueError, match="x has no spread in train"):
        scale(pl.DataFrame({"x": [3.0, 3.0]}), TEST, columns=["x"], method="z_score")


def test_nan_in_train_is_ignored_when_learning_the_range() -> None:
    train = pl.DataFrame({"x": [0.0, float("nan"), 10.0]})
    assert scale(train, TEST, columns=["x"], method="min_max")["train"]["x"].to_list() == [
        0.0,
        None,
        1.0,
    ]


def test_a_column_missing_from_either_table_is_a_column_error() -> None:
    with pytest.raises(pl.exceptions.ColumnNotFoundError):
        scale(
            pl.DataFrame({"x": [1.0, 2.0]}),
            pl.DataFrame({"z": [1.0]}),
            columns=["x"],
            method="min_max",
        )


def test_robust_uses_train_median_and_iqr_so_an_outlier_does_not_set_the_spread() -> None:
    train = pl.DataFrame({"x": [1.0, 2.0, 3.0, 4.0, 5.0, 1000.0]})
    out = scale(train, pl.DataFrame({"x": [3.5]}), columns=["x"], method="robust")
    # median 3.5, IQR = q75 4.75 - q25 2.25 = 2.5 (linear interpolation, as scikit-learn)
    assert out["train"]["x"].to_list()[:2] == pytest.approx([-1.0, -0.6])
    assert out["test"]["x"].to_list() == [0.0]


@pytest.mark.parametrize("method", ["min_max", "z_score", "robust"])
def test_plain_code_scales_as_the_step_does(method: str) -> None:
    train = pl.DataFrame({"x": [0.0, 10.0, float("nan"), 4.0, 7.0], "n": [1, 2, 3, 9, 4]})
    test = pl.DataFrame({"x": [5.0, None], "n": [0, 20]})
    settings: dict[str, Any] = {"columns": ["x", "n"], "method": method}
    namespace: dict[str, Any] = {"rows": train, "held_out": test}
    names = ({"train": "rows", "test": "held_out"}, {"train": "a", "test": "b"})
    exec(as_code(settings, *names), namespace)
    step = scale(train, test, **settings)
    assert namespace["a"].equals(step["train"])
    assert namespace["b"].equals(step["test"])


@settings(max_examples=40, deadline=None)
@given(text=st.text(min_size=1))
def test_column_names_never_become_code(code_shape: Callable[[str], str], text: str) -> None:
    def code(name: str) -> str:
        values = {"columns": [name], "method": "robust"}
        return as_code(values, {"train": "rows", "test": "held_out"}, {"train": "a", "test": "b"})

    assert code_shape(code(text)) == code_shape(code("x"))


def test_an_edited_value_in_the_code_is_read_back_as_the_setting() -> None:
    values = {"columns": ["x"], "method": "z_score"}
    names = ({"train": "rows", "test": "held_out"}, {"train": "a", "test": "b"})
    edited = as_code(values, *names).replace("['x']", "['y']")
    assert read_settings(as_code, values, *names, edited) == {**values, "columns": ["y"]}
