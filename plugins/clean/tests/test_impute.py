import polars as pl
import pytest

from sprisk_clean.impute import impute

TRAIN = pl.DataFrame({"x": [1.0, 2.0, None, 100.0], "y": [1, 2, 3, 4]})
TEST = pl.DataFrame({"x": [None, 5.0], "y": [5, 6]})


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
