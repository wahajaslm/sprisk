import polars as pl
import pytest
from test_linear_model import CLF, with_missing_target

from sprisk_ml.evaluate import evaluate
from sprisk_ml.models import linear_model


def test_regression_reports_error_metrics() -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    model = linear_model(df[::2], target="y", features=["x"], task="regression")
    m = evaluate(model, df[1::2], target="y", task="regression")["metrics"]
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


def test_classification_reports_a_confusion_matrix(clf_frame: pl.DataFrame) -> None:
    m = evaluate(linear_model(clf_frame, **CLF), clf_frame, target="y", task="classification")[
        "metrics"
    ]
    confusion = m["confusion"]
    assert confusion["labels"] == sorted(confusion["labels"])
    assert sum(map(sum, confusion["matrix"])) == clf_frame.height


def test_feature_importance_ranks_the_informative_feature_first(clf_frame: pl.DataFrame) -> None:
    from sprisk_ml.importance import feature_importance

    table = feature_importance(linear_model(clf_frame, **CLF), clf_frame, target="y", seed=0)[
        "importance"
    ]
    assert table.columns == ["feature", "importance", "std"]
    assert table["feature"][0] == "x"


def test_feature_importance_needs_a_complete_target(clf_frame: pl.DataFrame) -> None:
    from sprisk_ml.importance import feature_importance

    with pytest.raises(ValueError, match="missing values in test"):
        feature_importance(
            linear_model(clf_frame, **CLF), with_missing_target(clf_frame), target="y"
        )


def test_classification_draws_the_confusion_matrix(clf_frame: pl.DataFrame) -> None:
    out = evaluate(linear_model(clf_frame, **CLF), clf_frame, target="y", task="classification")
    [figure] = out["figures"]
    assert figure.data[0].type == "heatmap"
    assert figure.layout.title.text == "Confusion matrix"


def test_regression_draws_predicted_against_actual() -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    model = linear_model(df[::2], target="y", features=["x"], task="regression")
    [figure] = evaluate(model, df[1::2], target="y", task="regression")["figures"]
    assert figure.layout.title.text == "Predicted against actual"


def test_feature_importance_draws_a_bar_per_feature(clf_frame: pl.DataFrame) -> None:
    from sprisk_ml.importance import feature_importance

    out = feature_importance(linear_model(clf_frame, **CLF), clf_frame, target="y", seed=0)
    assert out["importance"]["feature"][0] == "x"
    [figure] = out["figures"]
    assert (
        figure.data[0].type == "bar"
        and list(figure.data[0].y) == out["importance"]["feature"].to_list()
    )
