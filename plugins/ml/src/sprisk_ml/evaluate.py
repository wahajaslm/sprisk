from typing import Any

import plotly.graph_objects as go
import polars as pl
import sklearn
from sklearn import metrics
from sklearn.base import is_classifier
from sklearn.pipeline import Pipeline


def evaluate(model: Pipeline, test: pl.DataFrame, target: str, task: str) -> dict[str, Any]:
    """Score a fitted model on the test table, and draw how it went. It never sees training rows."""
    if is_classifier(model) != (task == "classification"):
        raise ValueError(f"model is not a {task} model")
    if test[target].null_count():
        raise ValueError(f"{target} has {test[target].null_count()} missing values in test")
    # The model selects exactly the columns it was fit on.
    features = list(model.feature_names_in_)
    y_true = test[target].to_numpy()
    y_pred = model.predict(test.select(features))
    result: dict[str, Any] = {
        "n_rows": test.height,
        "estimator": type(model[-1]).__name__,
        "sklearn_version": sklearn.__version__,
    }
    if task == "classification":
        result["accuracy"] = float(metrics.accuracy_score(y_true, y_pred))
        result["balanced_accuracy"] = float(metrics.balanced_accuracy_score(y_true, y_pred))
        result["f1_macro"] = float(metrics.f1_score(y_true, y_pred, average="macro"))
        labels = sorted(set(y_true.tolist()) | set(y_pred.tolist()))
        matrix = metrics.confusion_matrix(y_true, y_pred, labels=labels)
        # Rows are the true class, columns the predicted class.
        result["confusion"] = {"labels": [str(v) for v in labels], "matrix": matrix.tolist()}
        figure = confusion_figure([str(v) for v in labels], matrix.tolist())
    else:
        result["rmse"] = float(metrics.root_mean_squared_error(y_true, y_pred))
        result["mae"] = float(metrics.mean_absolute_error(y_true, y_pred))
        result["r2"] = float(metrics.r2_score(y_true, y_pred))
        figure = predicted_figure(y_true.tolist(), y_pred.tolist(), target)
    return {"metrics": result, "figures": [figure]}


def confusion_figure(labels: list[str], matrix: list[list[int]]) -> go.Figure:
    """Rows are the true class, columns the predicted class; the diagonal is right."""
    heat = go.Heatmap(
        z=matrix,
        x=labels,
        y=labels,
        colorscale="Greys",
        reversescale=True,
        text=matrix,
        texttemplate="%{text}",
        showscale=False,
    )
    figure = go.Figure(heat, layout={"title": {"text": "Confusion matrix"}})
    figure.update_xaxes(title="predicted")
    figure.update_yaxes(title="true", autorange="reversed")
    return figure


def predicted_figure(actual: list[float], predicted: list[float], target: str) -> go.Figure:
    """Points on the diagonal are perfect predictions."""
    low, high = min(actual + predicted), max(actual + predicted)
    figure = go.Figure(
        [
            go.Scatter(x=actual, y=predicted, mode="markers", name="test rows", marker={"size": 5}),
            go.Scatter(
                x=[low, high], y=[low, high], mode="lines", name="perfect", line={"dash": "dot"}
            ),
        ],
        layout={"title": {"text": "Predicted against actual"}},
    )
    figure.update_xaxes(title=f"actual {target}")
    figure.update_yaxes(title=f"predicted {target}")
    return figure
