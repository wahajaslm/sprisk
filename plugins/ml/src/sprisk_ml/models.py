"""Models fit on the training table: preprocessing and estimator together, so nothing about
the test rows is learned."""

from typing import Any

import numpy as np
import polars as pl
import polars.selectors as cs
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .costs import costed, fixed, resolved


def dummy_baseline(
    train: pl.DataFrame,
    target: str,
    features: list[str],
    task: str,
    costs: dict[str, Any] | None = None,
) -> Any:
    """Always predicts the most frequent class, or the mean. Any real model should beat it.
    With `costs`, the class whose prediction for every row costs least."""
    model = dummy_baseline_estimator(train.select(features).schema, task)
    return fit(model, train, target, features, costs)


def dummy_baseline_estimator(schema: pl.Schema, task: str) -> Pipeline:
    estimator = (
        DummyClassifier(strategy="most_frequent")
        if task == "classification"
        else DummyRegressor(strategy="mean")
    )
    return Pipeline([("preprocess", preprocessor(schema, scale=True)), ("estimator", estimator)])


def linear_model(
    train: pl.DataFrame,
    target: str,
    features: list[str],
    task: str,
    costs: dict[str, Any] | None = None,
) -> Any:
    """Logistic regression for classes, linear regression for numbers. With `costs`, it
    predicts a class by the threshold that costs least on its training rows."""
    model = linear_model_estimator(train.select(features).schema, task)
    return fit(model, train, target, features, costs)


def linear_model_estimator(schema: pl.Schema, task: str) -> Pipeline:
    estimator = (
        LogisticRegression(max_iter=1000) if task == "classification" else LinearRegression()
    )
    return Pipeline([("preprocess", preprocessor(schema, scale=True)), ("estimator", estimator)])


def random_forest(
    train: pl.DataFrame,
    target: str,
    features: list[str],
    task: str,
    n_estimators: int = 200,
    seed: int = 0,
    min_samples_leaf: int = 1,
    max_features: float | None = None,
    costs: dict[str, Any] | None = None,
) -> Any:
    """A forest of decision trees; captures interactions a linear model misses. With `costs`,
    it predicts a class by the threshold that costs least on its training rows."""
    model = random_forest_estimator(
        train.select(features).schema, task, n_estimators, seed, min_samples_leaf, max_features
    )
    return fit(model, train, target, features, costs, seed)


def random_forest_estimator(
    schema: pl.Schema,
    task: str,
    n_estimators: int = 200,
    seed: int = 0,
    min_samples_leaf: int = 1,
    max_features: float | None = None,
) -> Pipeline:
    """`max_features` is the share of features each split may look at; unset, each task keeps
    scikit-learn's default."""
    forest = RandomForestClassifier if task == "classification" else RandomForestRegressor
    settings: dict[str, Any] = {"min_samples_leaf": min_samples_leaf}
    if max_features is not None:
        settings["max_features"] = max_features
    # Trees split on rank order, so scaling would change nothing.
    return Pipeline(
        [
            ("preprocess", preprocessor(schema, scale=False)),
            ("estimator", forest(n_estimators=n_estimators, random_state=seed, **settings)),
        ]
    )


def fit(
    model: Pipeline,
    train: pl.DataFrame,
    target: str,
    features: list[str],
    costs: dict[str, Any] | None = None,
    seed: int = 0,
) -> Any:
    """`model` fit on the train rows. With `costs` (ADR-0053), it first tunes its threshold
    for least cost on its own training rows."""
    if target in features:
        raise ValueError(f"target {target!r} is listed as a feature")
    if train[target].null_count():
        raise ValueError(f"{target} has {train[target].null_count()} missing values in train")
    x, y = train.select(features), train[target].to_numpy()
    if not costs:
        return model.fit(x, y)
    costs = resolved(costs, y, target)
    return fixed(costed(model, costs, seed).fit(x, y), x, y, costs["positive"])


class AsObject(TransformerMixin, BaseEstimator):  # type: ignore[misc]
    """Category columns as an object array. Its own class with no settings, so a model file
    names only this type: skops would let a file that names a numpy function call it."""

    def fit(self, x: Any, y: Any = None) -> "AsObject":
        return self

    def transform(self, x: Any) -> Any:
        return np.asarray(x, dtype=object)


def preprocessor(schema: pl.Schema, scale: bool) -> ColumnTransformer:
    """Numbers: fill gaps with the median, then standardise if `scale`. Text: fill with the
    most frequent value, then one-hot encode; a category seen only in test is ignored."""
    numeric = list(cs.expand_selector(schema, cs.numeric()))
    categorical = list(cs.expand_selector(schema, cs.string() | cs.categorical() | cs.boolean()))
    unsupported = sorted(set(schema) - set(numeric) - set(categorical))
    if unsupported:
        raise ValueError(f"columns {unsupported} are not numeric or categorical")
    numbers = SimpleImputer(strategy="median")
    return ColumnTransformer(
        [
            ("numeric", make_pipeline(numbers, StandardScaler()) if scale else numbers, numeric),
            (
                "categorical",
                make_pipeline(
                    # A gap-free boolean column arrives as a bool array, which the imputer
                    # refuses; as objects, every category column looks the same to it.
                    AsObject(),
                    # Polars text and boolean gaps reach sklearn as None, not NaN.
                    SimpleImputer(missing_values=None, strategy="most_frequent"),
                    OneHotEncoder(handle_unknown="ignore"),
                ),
                categorical,
            ),
        ]
    )
