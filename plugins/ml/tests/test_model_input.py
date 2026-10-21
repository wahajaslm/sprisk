"""A model step fits only the model (ADR-0056): it takes numbers with no gaps, and refuses
anything else naming the Clean step to add. Cross-validation trusts each manifest's
`estimator` to refit the same model per fold."""

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

from sprisk_ml.models import dummy_baseline, linear_model, random_forest
from sprisk_workers.plain import TRUSTED_MODEL_TYPES

OPERATORS = Path(__file__).parents[1] / "operators"
MODELS: dict[str, Callable[..., Any]] = {
    "linear_model": linear_model,
    "random_forest": random_forest,
    "dummy_baseline": dummy_baseline,
}
ESTIMATORS = {
    "linear_model": "LogisticRegression",
    "random_forest": "RandomForestClassifier",
    "dummy_baseline": "DummyClassifier",
}


def estimator(name: str) -> Callable[..., Any]:
    manifest = yaml.safe_load((OPERATORS / name / "manifest.yaml").read_text())
    module, function = manifest["model"]["estimator"].split(":")
    return getattr(importlib.import_module(module), function)  # type: ignore[no-any-return]


def rows(n: int, seed: int) -> pl.DataFrame:
    """A float and an integer feature, and a 0/1 target the float drives."""
    rng = np.random.default_rng(seed)
    x = rng.normal(size=n)
    return pl.DataFrame({"x": x, "i": [k % 7 for k in range(n)], "y": (x > 0).astype(int)})


def fit(name: str, train: pl.DataFrame, **settings: Any) -> Any:
    return MODELS[name](train, target="y", task="classification", **settings)


@pytest.mark.parametrize("name", MODELS)
def test_the_model_is_the_estimator_alone(name: str) -> None:
    assert type(fit(name, rows(60, seed=1))).__name__ == ESTIMATORS[name]


@pytest.mark.parametrize("name", MODELS)
def test_unset_features_are_every_column_but_the_target(name: str) -> None:
    assert list(fit(name, rows(60, seed=1)).feature_names_in_) == ["x", "i"]


@pytest.mark.parametrize("name", MODELS)
def test_columns_not_listed_as_features_are_left_alone(name: str) -> None:
    train = rows(60, seed=1).with_columns(note=pl.lit("free text"), gap=pl.lit(None))
    assert list(fit(name, train, features=["i", "x"]).feature_names_in_) == ["i", "x"]


@pytest.mark.parametrize("name", MODELS)
@pytest.mark.parametrize(
    "value", [pl.lit("a"), pl.lit("a").cast(pl.Categorical), pl.lit(True)], ids=str
)
def test_a_category_is_refused_naming_the_encode_step(name: str, value: pl.Expr) -> None:
    train = rows(60, seed=1).with_columns(value.alias("c"))
    with pytest.raises(ValueError, match="^c is not a number: add an Encode step before the model"):
        fit(name, train)


@pytest.mark.parametrize("name", MODELS)
def test_two_categories_are_named_together(name: str) -> None:
    train = rows(60, seed=1).with_columns(c=pl.lit("a"), d=pl.lit("b"))
    with pytest.raises(ValueError, match="^c, d are not numbers: add an Encode step"):
        fit(name, train)


@pytest.mark.parametrize("name", MODELS)
def test_a_gap_is_refused_naming_the_fill_steps(name: str) -> None:
    train = rows(60, seed=1).with_columns(x=pl.when(pl.col("i") == 3).then(None).otherwise("x"))
    with pytest.raises(
        ValueError, match="^x has missing values: add an Impute or Drop missing step before"
    ):
        fit(name, train)


@pytest.mark.parametrize("name", MODELS)
def test_a_date_is_refused_naming_the_select_step(name: str) -> None:
    train = rows(60, seed=1).with_columns(pl.lit(np.datetime64("2026-01-01")).alias("d"))
    with pytest.raises(
        ValueError,
        match="^d is not a number: leave it out with a Select columns step, or list the model's",
    ):
        fit(name, train)


@pytest.mark.parametrize("name", MODELS)
def test_the_estimator_is_the_fitted_model_before_its_fit(name: str) -> None:
    train, test = rows(60, seed=1), rows(30, seed=2)
    unfitted = estimator(name)(task="classification")
    with pytest.raises(NotFittedError):
        check_is_fitted(unfitted)

    refit = unfitted.fit(train.drop("y"), train["y"].to_numpy())
    np.testing.assert_array_equal(
        refit.predict_proba(test.drop("y")), fit(name, train).predict_proba(test.drop("y"))
    )


@pytest.mark.parametrize("name", MODELS)
def test_a_fitted_model_loads_back_under_the_workers_trusted_types(name: str) -> None:
    train, test = rows(60, seed=1), rows(30, seed=2)
    model = fit(name, train)
    loaded = skops.io.loads(skops.io.dumps(model), trusted=TRUSTED_MODEL_TYPES)
    np.testing.assert_array_equal(loaded.predict(test.drop("y")), model.predict(test.drop("y")))
