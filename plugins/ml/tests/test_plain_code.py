"""A model step's plain Python (ADR-0055) fits the model the step fits: same predictions."""

from typing import Any

import numpy as np
import polars as pl
import pytest

from sprisk_ml.models import random_forest, random_forest_as_code


def fitted_by_code(settings: dict[str, Any], train: pl.DataFrame) -> Any:
    namespace: dict[str, Any] = {"rows": train}
    exec(random_forest_as_code(settings, {"train": "rows"}, {"model": "forest"}), namespace)
    return namespace["forest"]


@pytest.mark.parametrize(
    "extra",
    [
        {},
        {"n_estimators": 30, "seed": 4, "min_samples_leaf": 3, "max_features": 0.5},
        {"costs": {"positive": "hi", "false_negative": 5.0, "false_positive": 1.0}},
    ],
)
def test_forest_code_predicts_as_the_step_does(
    clf_frame: pl.DataFrame, extra: dict[str, Any]
) -> None:
    settings = {"target": "y", "features": ["x", "c"], "task": "classification", **extra}
    train, test = clf_frame[::2], clf_frame[1::2].select("x", "c")
    step = random_forest(train, **settings)
    code = fitted_by_code(settings, train)
    assert np.array_equal(code.predict(test), step.predict(test))


def test_regression_forest_code_predicts_as_the_step_does(clf_frame: pl.DataFrame) -> None:
    rows = clf_frame.with_columns(pl.col("x").fill_null(0.0).alias("t"))
    settings = {"target": "t", "features": ["x", "c"], "task": "regression", "n_estimators": 20}
    step = random_forest(rows, **settings)
    code = fitted_by_code(settings, rows)
    test = rows.select("x", "c")
    assert np.allclose(code.predict(test), step.predict(test))
