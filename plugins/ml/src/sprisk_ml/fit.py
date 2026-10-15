from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl
import polars.selectors as cs
import skops.io
from sklearn.base import BaseEstimator
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from sprisk_workers.errors import OperatorError
from sprisk_workers.output import SKOPS, Output
from sprisk_workers.tables import read_table


def fit_pipeline(
    estimator: BaseEstimator, params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """Fit preprocessing and estimator together, on the training table only."""
    target, columns = params["target"], params["features"]
    if target in columns:
        raise OperatorError("target_in_features", f"target {target!r} is listed as a feature")
    train = read_table(inputs["train"], [target, *columns])
    if train[target].null_count():
        raise OperatorError("null_target", f"{target} has {train[target].null_count()} nulls")
    features = train.select(columns)
    model = Pipeline([("preprocess", _preprocessor(features)), ("estimator", estimator)])
    model.fit(features, train[target].to_numpy())
    path = out_dir / "model.skops"
    skops.io.dump(model, path)
    return [Output(port="model", path=path, media_type=SKOPS)]


def _preprocessor(features: pl.DataFrame) -> ColumnTransformer:
    numeric = features.select(cs.numeric()).columns
    categorical = features.select(cs.string() | cs.categorical() | cs.boolean()).columns
    unsupported = sorted(set(features.columns) - set(numeric) - set(categorical))
    if unsupported:
        raise OperatorError(
            "unsupported_feature_type", f"columns {unsupported} are not numeric or categorical"
        )
    return ColumnTransformer(
        [
            ("numeric", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), numeric),
            (
                "categorical",
                make_pipeline(
                    SimpleImputer(strategy="most_frequent"),
                    OneHotEncoder(handle_unknown="ignore"),
                ),
                categorical,
            ),
        ]
    )
