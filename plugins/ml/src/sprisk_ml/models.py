"""Models fit on the training table: preprocessing and estimator together, so nothing about
the test rows is learned."""

import polars as pl
import polars.selectors as cs
from sklearn.base import BaseEstimator
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


def dummy_baseline(train: pl.DataFrame, target: str, features: list[str], task: str) -> Pipeline:
    """Always predicts the most frequent class, or the mean. Any real model should beat it."""
    estimator = (
        DummyClassifier(strategy="most_frequent")
        if task == "classification"
        else DummyRegressor(strategy="mean")
    )
    return fit(estimator, train, target, features)


def linear_model(train: pl.DataFrame, target: str, features: list[str], task: str) -> Pipeline:
    """Logistic regression for classes, linear regression for numbers."""
    estimator = (
        LogisticRegression(max_iter=1000) if task == "classification" else LinearRegression()
    )
    return fit(estimator, train, target, features)


def random_forest(
    train: pl.DataFrame,
    target: str,
    features: list[str],
    task: str,
    n_estimators: int = 200,
    seed: int = 0,
) -> Pipeline:
    """A forest of decision trees; captures interactions a linear model misses."""
    forest = RandomForestClassifier if task == "classification" else RandomForestRegressor
    return fit(forest(n_estimators=n_estimators, random_state=seed), train, target, features)


def fit(
    estimator: BaseEstimator, train: pl.DataFrame, target: str, features: list[str]
) -> Pipeline:
    if target in features:
        raise ValueError(f"target {target!r} is listed as a feature")
    if train[target].null_count():
        raise ValueError(f"{target} has {train[target].null_count()} missing values in train")
    x = train.select(features)
    model = Pipeline([("preprocess", preprocessor(x)), ("estimator", estimator)])
    return model.fit(x, train[target].to_numpy())


def preprocessor(x: pl.DataFrame) -> ColumnTransformer:
    """Numbers: fill gaps with the median, then standardise. Text: fill with the most
    frequent value, then one-hot encode; a category seen only in test is ignored."""
    numeric = x.select(cs.numeric()).columns
    categorical = x.select(cs.string() | cs.categorical() | cs.boolean()).columns
    unsupported = sorted(set(x.columns) - set(numeric) - set(categorical))
    if unsupported:
        raise ValueError(f"columns {unsupported} are not numeric or categorical")
    return ColumnTransformer(
        [
            ("numeric", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), numeric),
            (
                "categorical",
                make_pipeline(
                    # Polars text and boolean gaps reach sklearn as None, not NaN.
                    SimpleImputer(missing_values=None, strategy="most_frequent"),
                    OneHotEncoder(handle_unknown="ignore"),
                ),
                categorical,
            ),
        ]
    )
