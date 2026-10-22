import numpy as np
import polars as pl
import pytest
from sklearn.preprocessing import PowerTransformer

from sprisk_clean.power_transform import power_transform

RNG = np.random.default_rng(7)
TRAIN = pl.DataFrame({"income": RNG.lognormal(size=200), "id": range(200)})
TEST = pl.DataFrame({"income": [0.5, 3.0, 40.0], "id": [1, 2, 3]})


def test_the_train_rows_set_the_transform_and_the_test_rows_get_the_same_one() -> None:
    out = power_transform(TRAIN, TEST, columns=["income"])
    fitted = PowerTransformer(method="yeo-johnson").fit(TRAIN.select("income").to_numpy())
    assert out["train"]["income"].to_numpy() == pytest.approx(
        fitted.transform(TRAIN.select("income").to_numpy()).ravel()
    )
    assert out["test"]["income"].to_numpy() == pytest.approx(
        fitted.transform(TEST.select("income").to_numpy()).ravel()
    )
    assert out["train"]["id"].to_list() == list(range(200))


def test_a_skewed_column_comes_out_close_to_symmetric() -> None:
    train = power_transform(TRAIN, TEST, columns=["income"])["train"]
    before, after = TRAIN["income"].skew(), train["income"].skew()
    assert before is not None and after is not None
    assert abs(before) > 2
    assert abs(after) < 0.2


def test_a_gap_stays_a_gap_and_does_not_set_the_transform() -> None:
    train = TRAIN.with_columns(pl.Series("income", [None, float("nan"), *TRAIN["income"][2:]]))
    out = power_transform(train, TEST, columns=["income"])
    assert out["train"]["income"][:2].to_list() == [None, None]
    fitted = PowerTransformer(method="yeo-johnson").fit(TRAIN["income"][2:].to_numpy()[:, None])
    assert out["test"]["income"].to_numpy() == pytest.approx(
        fitted.transform(TEST.select("income").to_numpy()).ravel()
    )


def test_a_constant_train_column_is_an_error() -> None:
    with pytest.raises(ValueError, match="income has no spread in train"):
        power_transform(pl.DataFrame({"income": [3.0, 3.0, None]}), TEST, columns=["income"])


def test_a_text_column_is_refused() -> None:
    text = pl.DataFrame({"income": ["high", "low"]})
    with pytest.raises(ValueError, match="income is not a number"):
        power_transform(text, text, columns=["income"])
