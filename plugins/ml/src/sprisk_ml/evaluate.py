from typing import Any

import numpy as np
import plotly.graph_objects as go
import polars as pl
import sklearn
from sklearn import metrics
from sklearn.base import is_classifier
from sklearn.frozen import FrozenEstimator
from sklearn.model_selection import FixedThresholdClassifier

from .costs import expected_cost, resolved
from .models import Words, scoring_input

SAMPLE_ROWS = 20


def evaluate(
    model: Any, test: pl.DataFrame, target: str, task: str, words: Words | None = None
) -> dict[str, Any]:
    """Score a fitted model on the test table, with the test words beside it when the model was
    fit on words (ADR-0058), and draw how it went. It never sees training rows. A model that
    decides by costs (ADR-0053) also reports its cut-off and expected cost."""
    if is_classifier(model) != (task == "classification"):
        raise ValueError(f"model is not a {task} model")
    if test[target].null_count():
        raise ValueError(f"{target} has {test[target].null_count()} missing values in test")
    y_true = test[target].to_numpy()
    x = scoring_input(model, test, words)
    y_pred = model.predict(x)
    result: dict[str, Any] = {
        "n_rows": test.height,
        "estimator": type(_estimator(model)).__name__,
        "sklearn_version": sklearn.__version__,
    }
    if isinstance(model, FixedThresholdClassifier):
        result["cut_off"] = {"positive": str(model.pos_label), "at": float(model.threshold)}
        costs = resolved(model.costs_, y_true, target)
        result["expected_cost"] = expected_cost(
            y_true, y_pred, costs["positive"], costs["false_negative"], costs["false_positive"]
        )
    if task == "classification":
        result["schema_version"] = "sprisk.classification_report/v1"
        result["accuracy"] = float(metrics.accuracy_score(y_true, y_pred))
        result["balanced_accuracy"] = float(metrics.balanced_accuracy_score(y_true, y_pred))
        result["f1_macro"] = float(metrics.f1_score(y_true, y_pred, average="macro"))
        # The metric a person may compare models by (ADR-0059), so the test rows report it.
        result["weighted_f1"] = float(metrics.f1_score(y_true, y_pred, average="weighted"))
        labels = sorted(set(y_true.tolist()) | set(y_pred.tolist()))
        matrix = metrics.confusion_matrix(y_true, y_pred, labels=labels)
        # Rows are the true class, columns the predicted class.
        names = [str(v) for v in labels]
        result["confusion"] = {"labels": names, "matrix": matrix.tolist()}
        result["per_class"] = per_class(y_true, y_pred, labels)
        result["top_confusions"] = top_confusions(names, matrix)
        wrong = np.flatnonzero(y_true != y_pred)
        margins = error_margins(model, x, wrong)
        if margins is not None and len(wrong):
            kind, values = margins
            counts, edges = np.histogram(values, bins=10)
            result["error_margins"] = {
                "kind": kind,
                "edges": edges.tolist(),
                "counts": counts.tolist(),
            }
        result["misclassified_sample"] = misclassified_sample(
            y_true, y_pred, wrong, None if margins is None else margins[1]
        )
        figure = confusion_figure(names, matrix.tolist())
    else:
        result["rmse"] = float(metrics.root_mean_squared_error(y_true, y_pred))
        result["mae"] = float(metrics.mean_absolute_error(y_true, y_pred))
        result["r2"] = float(metrics.r2_score(y_true, y_pred))
        figure = predicted_figure(y_true.tolist(), y_pred.tolist(), target)
    return {"metrics": result, "figures": [figure]}


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055): the headline metrics, and for a
    classifier its per-class report and confusion matrix; a test checks it scores as the step
    does. Helper names start with the metrics output's name, so they never replace a person's.
    With words, it reads the table columns the model's own cell named (`<model>_columns`)."""
    model, test, scores = inputs["model"], inputs["test"], outputs["metrics"]
    target = settings["target"]
    if "words" in inputs:
        rows = f"{test}.select({model}_columns).to_numpy().astype(float).reshape({test}.height, -1)"
        x = (
            "sparse.hstack([\n"
            f"    sparse.csr_array({rows}),\n"
            f"    {inputs['words']},\n"
            '], format="csr")'
        )
        code = "import sklearn.metrics\nfrom scipy import sparse\n\n"
    else:
        x = f"{test}.select(list({model}.feature_names_in_))"
        code = "import sklearn.metrics\n\n"
    true, predicted = f"{scores}_true", f"{scores}_predicted"
    code += f"{true} = {test}[{target!r}].to_numpy()\n{predicted} = {model}.predict({x})\n"
    if settings["task"] == "regression":
        return code + (
            f"{scores} = {{\n"
            f'    "rmse": sklearn.metrics.root_mean_squared_error({true}, {predicted}),\n'
            f'    "mae": sklearn.metrics.mean_absolute_error({true}, {predicted}),\n'
            f'    "r2": sklearn.metrics.r2_score({true}, {predicted}),\n'
            "}\n"
        )
    return code + (
        "# Precision, recall, F1 and support of each class.\n"
        f"print(sklearn.metrics.classification_report({true}, {predicted}, zero_division=0))\n"
        "# Rows are the true class, columns the predicted class, both in sorted order.\n"
        f"print(sklearn.metrics.confusion_matrix({true}, {predicted}))\n"
        "# A model fit with costs also has a cut-off and an expected cost: the step reports\n"
        "# them, this cell does not.\n"
        f"{scores} = {{\n"
        f'    "accuracy": sklearn.metrics.accuracy_score({true}, {predicted}),\n'
        f'    "balanced_accuracy": sklearn.metrics.balanced_accuracy_score({true}, {predicted}),\n'
        f'    "f1_macro": sklearn.metrics.f1_score({true}, {predicted}, average="macro"),\n'
        f'    "weighted_f1": sklearn.metrics.f1_score({true}, {predicted}, average="weighted"),\n'
        "}\n"
    )


def per_class(y_true: Any, y_pred: Any, labels: list[Any]) -> list[dict[str, Any]]:
    report = metrics.classification_report(
        y_true, y_pred, labels=labels, output_dict=True, zero_division=0
    )
    return [
        {
            "label": str(label),
            "precision": float(report[str(label)]["precision"]),
            "recall": float(report[str(label)]["recall"]),
            "f1": float(report[str(label)]["f1-score"]),
            "support": int(report[str(label)]["support"]),
        }
        for label in labels
    ]


def top_confusions(labels: list[str], matrix: np.ndarray) -> list[dict[str, Any]]:
    """The 10 largest off-diagonal cells: which true class is most often taken for which."""
    cells = [
        (int(matrix[i, j]), labels[i], labels[j])
        for i in range(len(labels))
        for j in range(len(labels))
        if i != j and matrix[i, j]
    ]
    largest = sorted(cells, key=lambda cell: -cell[0])[:10]
    return [{"true": t, "predicted": p, "count": n} for n, t, p in largest]


def error_margins(model: Any, x: Any, wrong: np.ndarray) -> tuple[str, np.ndarray] | None:
    """How close each wrong row came to the decision: the top score minus the runner-up.
    None when the model gives no scores."""
    if isinstance(model, FixedThresholdClassifier):
        # It decides by its cut-off on the positive class's probability, not by the top class.
        positive = list(model.classes_).index(model.pos_label)
        return "cut_off", np.abs(model.predict_proba(x)[wrong, positive] - model.threshold)
    if hasattr(model, "predict_proba"):
        return "proba", _top_two_gap(model.predict_proba(x)[wrong])
    if hasattr(model, "decision_function"):
        scores = model.decision_function(x)[wrong]
        # Two classes give one signed score per row; its size is the distance from the boundary.
        return "decision", np.abs(scores) if scores.ndim == 1 else _top_two_gap(scores)
    return None


def _top_two_gap(scores: np.ndarray) -> np.ndarray:
    top = np.sort(scores, axis=1)
    gap: np.ndarray = top[:, -1] - top[:, -2]
    return gap


def misclassified_sample(
    y_true: Any, y_pred: Any, wrong: np.ndarray, margins: np.ndarray | None
) -> dict[str, Any]:
    """At most 20 wrong rows, picked with a fixed seed, by their row in the test table. No
    feature values: they stay in the test table, which shows its rows through its own page."""
    picked = np.arange(len(wrong))
    if len(wrong) > SAMPLE_ROWS:
        picked = np.sort(np.random.default_rng(0).choice(len(wrong), SAMPLE_ROWS, replace=False))
    rows = []
    for k in picked:
        i = int(wrong[k])
        row: dict[str, Any] = {"row": i, "true": str(y_true[i]), "predicted": str(y_pred[i])}
        if margins is not None:
            row["margin"] = float(margins[k])
        rows.append(row)
    return {"rows": rows, "n_total": len(wrong)}


def _estimator(model: Any) -> Any:
    """The estimator inside a model that decides by costs."""
    if not isinstance(model, FixedThresholdClassifier):
        return model
    inner = model.estimator_
    return inner.estimator if isinstance(inner, FrozenEstimator) else inner


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
