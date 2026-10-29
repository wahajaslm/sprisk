from collections.abc import Callable
from typing import Any

import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from sprisk_clean.impute import impute as step_function
from sprisk_workers.notebook_code import read_settings, source_cell

TRAIN = pl.DataFrame({"x": [1.0, 2.0, None, 100.0], "y": [1, 2, 3, 4]})
TEST = pl.DataFrame({"x": [None, 5.0], "y": [5, 6]})


# The step's notebook cell is its own function (ADR-0071).
as_code = source_cell(step_function)


def impute(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """The step's outputs by port name."""
    return dict(zip(("train", "test"), step_function(*args, **kwargs), strict=True))


@pytest.mark.parametrize(("method", "fill"), [("median", 2.0), ("mean", 103.0 / 3), ("zero", 0.0)])
def test_fills_test_gaps_with_a_statistic_of_train_only(method: str, fill: float) -> None:
    out = impute(TRAIN, TEST, columns=["x"], method=method)
    assert out["test"]["x"].to_list() == pytest.approx([fill, 5.0])
    assert out["train"]["x"].null_count() == 0
    assert out["train"]["y"].to_list() == [1, 2, 3, 4], "other columns untouched"


def test_column_that_is_empty_in_train_is_an_error() -> None:
    empty = TRAIN.with_columns(pl.lit(None, dtype=pl.Float64).alias("x"))
    with pytest.raises(ValueError, match="x has no values in train"):
        impute(empty, TEST, columns=["x"], method="mean")


def test_nan_is_treated_as_missing() -> None:
    train = pl.DataFrame({"x": [1.0, float("nan"), 3.0]})
    test = pl.DataFrame({"x": [float("nan")]})
    out = impute(train, test, columns=["x"], method="mean")
    assert out["train"]["x"].to_list() == [1.0, 2.0, 3.0]
    assert out["test"]["x"].to_list() == [2.0]


def test_each_text_column_gets_its_own_fill_beside_a_number_fill() -> None:
    # A category gap becomes a named category; a free-text gap becomes no words at all.
    train = pl.DataFrame(
        {"x": [1.0, None, 3.0], "kind": ["a", None, "b"], "about": ["red shirt", None, "blue"]}
    )
    test = pl.DataFrame({"x": [None], "kind": [None], "about": [None]}, schema=train.schema)
    fills = {"kind": "missing", "about": ""}
    out = impute(train, test, columns=["x", "kind", "about"], method="median", text_fill=fills)
    assert out["train"]["kind"].to_list() == ["a", "missing", "b"]
    assert out["train"]["about"].to_list() == ["red shirt", "", "blue"]
    assert out["test"].to_dicts() == [{"x": 2.0, "kind": "missing", "about": ""}]


def test_a_text_column_without_a_text_fill_is_an_error() -> None:
    train = pl.DataFrame({"kind": ["a", None]})
    with pytest.raises(ValueError, match="kind is text: give it a text_fill"):
        impute(train, train, columns=["kind"], method="median", text_fill={})


def test_a_column_neither_number_nor_text_is_an_error() -> None:
    train = pl.DataFrame({"flag": [True, None]})
    with pytest.raises(ValueError, match="flag is Boolean"):
        impute(train, train, columns=["flag"], method="median", text_fill={"flag": "missing"})


def test_a_named_fill_the_column_already_has_is_an_error() -> None:
    # The gaps would merge with a real category and lose their own meaning.
    train = pl.DataFrame({"kind": ["a", None]})
    test = pl.DataFrame({"kind": ["missing"]})
    with pytest.raises(ValueError, match="kind already has the value 'missing'"):
        impute(train, test, columns=["kind"], method="median", text_fill={"kind": "missing"})


def test_an_empty_fill_may_meet_empty_text_already_there() -> None:
    # Empty text and a gap both mean no words, so merging them loses nothing.
    train = pl.DataFrame({"about": ["", None, "red"]})
    out = impute(train, train, columns=["about"], method="median", text_fill={"about": ""})
    assert out["train"]["about"].to_list() == ["", "", "red"]


MIXED = pl.DataFrame(
    {"x": [1.0, float("nan"), 3.0, 8.0], "n": [1, None, 3, 4], "kind": ["a", None, "b", "a"]}
)
MIXED_TEST = pl.DataFrame({"x": [None, 2.0], "n": [None, 1], "kind": [None, "c"]})


@pytest.mark.parametrize("method", ["median", "mean", "zero"])
def test_plain_code_fills_as_the_step_does(method: str) -> None:
    settings: dict[str, Any] = {"columns": ["x", "n", "kind"], "method": method}
    settings["text_fill"] = {"kind": "missing"}
    namespace: dict[str, Any] = {"rows": MIXED, "held_out": MIXED_TEST}
    names = ({"train": "rows", "test": "held_out"}, {"train": "a", "test": "b"})
    exec(as_code(settings, *names), namespace)
    step = impute(MIXED, MIXED_TEST, **settings)
    assert namespace["a"].equals(step["train"])
    assert namespace["b"].equals(step["test"])


def test_plain_code_fills_a_text_gap_as_the_step_does() -> None:
    settings: dict[str, Any] = {"columns": ["x", "kind"], "method": "mean", "text_gap": "none"}
    namespace: dict[str, Any] = {"rows": MIXED, "held_out": MIXED_TEST}
    names = ({"train": "rows", "test": "held_out"}, {"train": "a", "test": "b"})
    exec(as_code(settings, *names), namespace)
    step = impute(MIXED, MIXED_TEST, **settings)
    assert namespace["a"].equals(step["train"])
    assert namespace["b"].equals(step["test"])


@settings(max_examples=40, deadline=None)
@given(text=st.text(min_size=1))
def test_dataset_text_never_becomes_code(code_shape: Callable[[str], str], text: str) -> None:
    def code(name: str) -> str:
        values = {"columns": [name], "method": "median", "text_fill": {name: name}}
        return as_code(values, {"train": "rows", "test": "held_out"}, {"train": "a", "test": "b"})

    assert code_shape(code(text)) == code_shape(code("kind"))


def test_an_edited_value_in_the_code_is_read_back_as_the_setting() -> None:
    values = {"columns": ["x"], "method": "median"}
    names = ({"train": "rows", "test": "held_out"}, {"train": "a", "test": "b"})
    edited = as_code(values, *names).replace("['x']", "['y']")
    assert read_settings(as_code, values, *names, edited) == {**values, "columns": ["y"]}


def test_a_text_gap_fill_covers_every_text_column_text_fill_leaves_out() -> None:
    train = pl.DataFrame({"kind": ["a", None], "size": ["s", None], "x": [1.0, None]})
    out = impute(
        train,
        train,
        columns=["kind", "size", "x"],
        method="mean",
        text_fill={"size": "none"},
        text_gap="missing",
    )
    assert out["train"]["kind"].to_list() == ["a", "missing"]
    assert out["train"]["size"].to_list() == ["s", "none"]
