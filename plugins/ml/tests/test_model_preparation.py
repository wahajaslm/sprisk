"""Each model manifest's `model` claims, checked on the code. Preparation rules trust
`prepares` to skip an impute or scale step before the model, so a false claim breaks real
flows; cross-validation trusts `estimator` to refit the same model per fold."""

import importlib
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import pytest
import skops.io
import yaml
from sklearn.exceptions import NotFittedError
from sklearn.utils.validation import check_is_fitted

from sprisk_ml.evaluate import evaluate
from sprisk_ml.importance import feature_importance
from sprisk_ml.models import dummy_baseline, linear_model, random_forest
from sprisk_workers.plain import TRUSTED_MODEL_TYPES

OPERATORS = Path(__file__).parents[1] / "operators"
MODELS: dict[str, Callable[..., Any]] = {
    "linear_model": linear_model,
    "random_forest": random_forest,
    "dummy_baseline": dummy_baseline,
}
FEATURES = ["x", "i", "c", "b"]


def claims(name: str) -> dict[str, Any]:
    manifest = yaml.safe_load((OPERATORS / name / "manifest.yaml").read_text())
    return dict(manifest["model"])


def prepares(name: str) -> list[str]:
    return list(claims(name)["prepares"])


def estimator(name: str) -> Callable[..., Any]:
    module, function = claims(name)["estimator"].split(":")
    return getattr(importlib.import_module(module), function)  # type: ignore[no-any-return]


def rows(n: int, seed: int) -> pl.DataFrame:
    """A float, an integer, a text and a boolean feature, each with every fifth value missing."""
    rng = np.random.default_rng(seed)
    x = rng.normal(size=n)
    gap = [k % 5 == 0 for k in range(n)]
    return pl.DataFrame(
        {
            "x": [None if g else float(v) for g, v in zip(gap, x, strict=True)],
            "i": [None if g else int(k % 7) for k, g in enumerate(gap)],
            "c": [None if g else "abc"[k % 3] for k, g in enumerate(gap)],
            "b": [None if g else k % 2 == 0 for k, g in enumerate(gap)],
            "y": (x > 0).astype(int),
        },
        schema={"x": pl.Float64, "i": pl.Int64, "c": pl.String, "b": pl.Boolean, "y": pl.Int64},
    )


def fit(name: str, train: pl.DataFrame) -> Any:
    return MODELS[name](train, target="y", features=FEATURES, task="classification")


@pytest.mark.parametrize("name", MODELS)
def test_a_model_that_fills_gaps_fills_every_kind_of_column_and_scores_rows_with_gaps(
    name: str,
) -> None:
    assert "fill_gaps" in prepares(name)
    train, test = rows(60, seed=1), rows(30, seed=2)
    model = fit(name, train)

    encoder = model.named_steps["preprocess"].named_transformers_["categorical"][-1]
    assert all(None not in categories for categories in encoder.categories_)
    assert not np.isnan(model.named_steps["preprocess"].transform(test.select(FEATURES))).any()
    assert evaluate(model, test, target="y", task="classification")["metrics"]["n_rows"] == 30
    assert feature_importance(model, test, target="y")["importance"].height == len(FEATURES)


@pytest.mark.parametrize("name", MODELS)
def test_the_estimator_is_the_fitted_model_before_its_fit(name: str) -> None:
    train, test = rows(60, seed=1), rows(30, seed=2)
    unfitted = estimator(name)(schema=train.select(FEATURES).schema, task="classification")
    with pytest.raises(NotFittedError):
        check_is_fitted(unfitted)

    refit = unfitted.fit(train.select(FEATURES), train["y"].to_numpy())
    np.testing.assert_array_equal(
        refit.predict_proba(test.select(FEATURES)),
        fit(name, train).predict_proba(test.select(FEATURES)),
    )


STANDARDIZING = [n for n in MODELS if "standardize" in prepares(n)]
NOT_STANDARDIZING = [n for n in MODELS if "standardize" not in prepares(n)]


def test_tree_models_do_not_standardize() -> None:
    assert NOT_STANDARDIZING == ["random_forest"]


@pytest.mark.parametrize("name", STANDARDIZING)
def test_a_model_that_standardizes_is_unchanged_by_affine_scaling_before_it(name: str) -> None:
    train, test = rows(60, seed=1), rows(30, seed=2)

    def rescale(frame: pl.DataFrame) -> pl.DataFrame:
        return frame.with_columns(pl.col("x") * 7.0 + 3.0, pl.col("i") * 2.5 - 1.0)

    raw = fit(name, train).predict_proba(test.select(FEATURES))
    scaled = fit(name, rescale(train)).predict_proba(rescale(test).select(FEATURES))
    np.testing.assert_allclose(raw, scaled, atol=1e-9)


@pytest.mark.parametrize("name", NOT_STANDARDIZING)
def test_a_model_that_does_not_standardize_takes_numbers_as_they_are(name: str) -> None:
    train = rows(60, seed=1)
    numbers = fit(name, train).named_steps["preprocess"].named_transformers_["numeric"]
    filled = train.select("x", "i").fill_null(strategy="mean").to_numpy()
    observed = train.select(pl.all_horizontal(pl.col("x", "i").is_not_null())).to_series()
    np.testing.assert_allclose(
        numbers.transform(train.select("x", "i"))[observed.to_numpy()],
        filled[observed.to_numpy()],
    )


@pytest.mark.parametrize("name", MODELS)
def test_a_boolean_feature_without_gaps_is_encoded_like_any_category(name: str) -> None:
    train = rows(60, seed=1).with_columns(pl.col("b").fill_null(False))
    model = MODELS[name](train, target="y", features=["x", "b"], task="classification")
    assert model.predict(train.select("x", "b")).shape == (60,)


@pytest.mark.parametrize("name", MODELS)
def test_a_fitted_model_loads_back_under_the_workers_trusted_types(name: str) -> None:
    train, test = rows(60, seed=1), rows(30, seed=2)
    model = fit(name, train)
    loaded = skops.io.loads(skops.io.dumps(model), trusted=TRUSTED_MODEL_TYPES)
    np.testing.assert_array_equal(
        loaded.predict(test.select(FEATURES)), model.predict(test.select(FEATURES))
    )
