from collections.abc import Callable
from typing import Any

import numpy as np
import plotly.graph_objects as go
import polars as pl
from sklearn.inspection import permutation_importance
from sklearn.pipeline import Pipeline


def feature_importance(
    model: Pipeline, test: pl.DataFrame, target: str, seed: int = 0
) -> dict[str, Any]:
    """How much the model's score drops when one feature's values are shuffled in the test
    rows (permutation importance). Predictive importance for this model only, not causal;
    correlated features share or mask importance. A report about one fitted model; never use
    it to choose features or models, or the test set stops being held out."""
    features = list(model.feature_names_in_)
    if test[target].null_count():
        raise ValueError(f"{target} has {test[target].null_count()} missing values in test")
    means, stds = permutation(model, test.select(features), test[target].to_numpy(), seed, 10)
    table = pl.DataFrame({"feature": features, "importance": means, "std": stds}).sort(
        "importance", descending=True
    )
    figure = importance_figure(
        table["feature"].to_list(),
        table["importance"].to_list(),
        table["std"].to_list(),
        "Permutation importance (predictive, not causal)",
    )
    return {"importance": table, "figures": [figure]}


def permutation(
    model: Any,
    x: pl.DataFrame,
    y: Any,
    seed: int,
    repeats: int,
    scorer: Callable[[Any, pl.DataFrame, Any], float] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Each feature's mean and SD drop in score when its values are shuffled in `x`, by
    `scorer` (the model's own score when None)."""
    measure = scorer or (lambda estimator, frame, truth: float(estimator.score(frame, truth)))

    def score(estimator: Any, rows: Any, truth: Any) -> float:
        # permutation_importance shuffles a plain array; give the model its typed columns back.
        # The array holds a numeric gap as NaN, so it becomes a gap again before the cast.
        columns = [
            pl.Series(name, rows[:, k].tolist(), strict=False) for k, name in enumerate(x.columns)
        ]
        frame = pl.DataFrame([c.fill_nan(None) if c.dtype.is_float() else c for c in columns])
        return measure(estimator, frame.cast(x.schema), truth)

    result = permutation_importance(
        model, x.to_numpy(), y, scoring=score, n_repeats=repeats, random_state=seed
    )
    return result.importances_mean, result.importances_std


def importance_figure(
    features: list[str], importance: list[float], spread: list[float], title: str
) -> go.Figure:
    bars = go.Bar(x=importance, y=features, orientation="h", error_x={"array": spread})
    figure = go.Figure(bars, layout={"title": {"text": title}})
    figure.update_yaxes(autorange="reversed")
    figure.update_xaxes(title="drop in score when shuffled")
    return figure
