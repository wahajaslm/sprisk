import polars as pl
import pytest

from sprisk_clean.scale import scale

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
