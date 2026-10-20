import polars as pl
import pytest

from sprisk_clean.clip_outliers import clip_outliers

TRAIN = pl.DataFrame({"x": [1.0, 2.0, 3.0, 4.0, 100.0]})
TEST = pl.DataFrame({"x": [-50.0, 3.0, 500.0]})


def test_clips_to_the_train_iqr_fence() -> None:
    out = clip_outliers(TRAIN, TEST, columns=["x"], k=1.5)
    # Train quartiles 2 and 4, IQR 2, fence [-1, 7].
    assert out["train"]["x"].to_list() == [1.0, 2.0, 3.0, 4.0, 7.0]
    assert out["test"]["x"].to_list() == [-1.0, 3.0, 7.0]
    assert out["train"].height == 5, "rows are clipped, never dropped"


def test_column_that_is_empty_in_train_is_an_error() -> None:
    empty = pl.DataFrame({"x": [None, None]}, schema={"x": pl.Float64})
    with pytest.raises(ValueError, match="x has no values in train"):
        clip_outliers(empty, TEST, columns=["x"], k=1.5)


def test_a_column_with_no_iqr_spread_is_an_error_since_clipping_would_flatten_it() -> None:
    flag = pl.DataFrame({"x": [0.0] * 9 + [1.0]})
    with pytest.raises(ValueError, match="x has no IQR spread in train"):
        clip_outliers(flag, TEST, columns=["x"], k=1.5)
