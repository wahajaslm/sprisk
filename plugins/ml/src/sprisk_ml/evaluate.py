from typing import Any

import polars as pl
import sklearn
from sklearn import metrics
from sklearn.base import is_classifier
from sklearn.pipeline import Pipeline


def evaluate(model: Pipeline, test: pl.DataFrame, target: str, task: str) -> dict[str, Any]:
    """Score a fitted model on the test table. It never sees training rows."""
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
    else:
        result["rmse"] = float(metrics.root_mean_squared_error(y_true, y_pred))
        result["mae"] = float(metrics.mean_absolute_error(y_true, y_pred))
        result["r2"] = float(metrics.r2_score(y_true, y_pred))
    return result
