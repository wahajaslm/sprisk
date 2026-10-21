from typing import Any

import polars as pl
import pytest

from sprisk_ml.evaluate import evaluate
from sprisk_ml.models import dummy_baseline, linear_model

CLF: dict[str, Any] = {"target": "y", "task": "classification", "features": ["x", "c"]}


def test_logistic_beats_dummy_on_separable_data(clf_numbers: pl.DataFrame) -> None:
    train, test = clf_numbers[::2], clf_numbers[1::2]
    dummy = evaluate(dummy_baseline(train, **CLF), test, target="y", task="classification")[
        "metrics"
    ]
    linear = evaluate(linear_model(train, **CLF), test, target="y", task="classification")[
        "metrics"
    ]
    assert dummy["balanced_accuracy"] == pytest.approx(0.5)
    assert dummy["estimator"] == "DummyClassifier"
    assert linear["accuracy"] > 0.9
    assert linear["n_rows"] == 30
    assert linear["estimator"] == "LogisticRegression"
    assert set(linear) == {
        "n_rows",
        "estimator",
        "sklearn_version",
        "accuracy",
        "balanced_accuracy",
        "f1_macro",
        "confusion",
    }
