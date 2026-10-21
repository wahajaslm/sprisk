import datetime as dt
from typing import Any

import polars as pl
import pytest

from sprisk_ml.evaluate import evaluate
from sprisk_ml.models import linear_model

CLF: dict[str, Any] = {"target": "y", "task": "classification", "features": ["x", "c"]}


def test_only_listed_features_are_used(clf_frame: pl.DataFrame) -> None:
    # A datetime split column next to the features must be ignored, not fit on.
    times = pl.datetime_range(
        dt.datetime(2026, 1, 1), dt.datetime(2026, 1, 1) + dt.timedelta(hours=59), "1h", eager=True
    )
    df = clf_frame.with_columns(times.alias("t"))
    m = evaluate(linear_model(df[::2], **CLF), df[1::2], target="y", task="classification")[
        "metrics"
    ]
    assert m["accuracy"] > 0.9


def test_category_seen_only_in_test_does_not_break_prediction(clf_frame: pl.DataFrame) -> None:
    # The encoder is fit on train only, so it has never seen "unseen".
    test = clf_frame[28:32].with_columns(pl.lit("unseen").alias("c"))
    assert (
        evaluate(linear_model(clf_frame, **CLF), test, target="y", task="classification")[
            "metrics"
        ]["n_rows"]
        == 4
    )


@pytest.mark.parametrize(
    ("params", "error"),
    [
        ({**CLF, "features": ["x", "missing"]}, pl.exceptions.ColumnNotFoundError),
        ({**CLF, "target": "missing"}, pl.exceptions.ColumnNotFoundError),
        ({**CLF, "features": ["x", "y"]}, ValueError),
    ],
)
def test_bad_columns_are_errors(
    params: dict[str, Any], error: type[Exception], clf_frame: pl.DataFrame
) -> None:
    with pytest.raises(error):
        linear_model(clf_frame, **params)


def test_unsupported_feature_type_is_an_error(clf_frame: pl.DataFrame) -> None:
    df = clf_frame.with_columns(pl.lit(dt.date(2026, 1, 1)).alias("d"))
    with pytest.raises(ValueError, match="not numeric or categorical"):
        linear_model(df, **{**CLF, "features": ["x", "d"]})


def test_missing_target_in_train_is_an_error(clf_frame: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="missing values in train"):
        linear_model(with_missing_target(clf_frame), **CLF)


def with_missing_target(df: pl.DataFrame) -> pl.DataFrame:
    return df.with_columns(pl.when(pl.col("x") == 3).then(None).otherwise(pl.col("y")).alias("y"))


def test_random_forest_fits_and_scores(clf_frame: pl.DataFrame) -> None:
    from sprisk_ml.models import random_forest

    model = random_forest(clf_frame[::2], **CLF, n_estimators=50, seed=0)
    m = evaluate(model, clf_frame[1::2], target="y", task="classification")["metrics"]
    assert m["estimator"] == "RandomForestClassifier" and m["accuracy"] > 0.8


def test_random_forest_takes_its_searched_settings_and_keeps_its_task_defaults(
    clf_frame: pl.DataFrame,
) -> None:
    from sprisk_ml.models import random_forest_estimator

    schema = clf_frame.select(CLF["features"]).schema
    tuned = random_forest_estimator(
        schema, "classification", min_samples_leaf=5, max_features=0.5
    ).named_steps["estimator"]
    assert (tuned.min_samples_leaf, tuned.max_features) == (5, 0.5)
    # Unset, each task keeps scikit-learn's own default.
    forest = random_forest_estimator(schema, "classification").named_steps["estimator"]
    assert (forest.min_samples_leaf, forest.max_features) == (1, "sqrt")
    forest = random_forest_estimator(schema, "regression").named_steps["estimator"]
    assert forest.max_features == 1.0
