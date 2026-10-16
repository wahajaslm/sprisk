import polars as pl
import pytest
from test_linear_model import CLF, with_missing_target

from sprisk_ml.evaluate import evaluate
from sprisk_ml.models import linear_model


def test_regression_reports_error_metrics() -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    model = linear_model(df[::2], target="y", features=["x"], task="regression")
    m = evaluate(model, df[1::2], target="y", task="regression")
    assert m["rmse"] == pytest.approx(0.0, abs=1e-6)
    assert {"rmse", "mae", "r2"} <= set(m)


def test_missing_target_in_test_is_an_error(clf_frame: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="missing values in test"):
        evaluate(
            linear_model(clf_frame, **CLF),
            with_missing_target(clf_frame),
            target="y",
            task="classification",
        )


def test_task_mismatch_between_model_and_evaluate_is_an_error(clf_frame: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="not a regression model"):
        evaluate(linear_model(clf_frame, **CLF), clf_frame, target="y", task="regression")
