from collections.abc import Callable
from typing import Any

import numpy as np
import plotly.graph_objects as go
import polars as pl
from scipy import sparse
from sklearn.inspection import permutation_importance
from sklearn.pipeline import Pipeline

from .models import Words, scoring_input


def feature_importance(
    model: Pipeline,
    test: pl.DataFrame,
    target: str,
    seed: int = 0,
    words: Words | None = None,
) -> dict[str, Any]:
    """How much the model's score drops when one feature's values are shuffled in the test
    rows (permutation importance). Predictive importance for this model only, not causal;
    correlated features share or mask importance. A report about one fitted model; never use
    it to choose features or models, or the test set stops being held out. A model fit on
    words (ADR-0058) has each text column's words shuffled together, as one feature named
    after the column, as cross-validation names it."""
    if test[target].null_count():
        raise ValueError(f"{target} has {test[target].null_count()} missing values in test")
    x, truth = scoring_input(model, test, words), test[target].to_numpy()
    if words is None:
        features = list(x.columns)
        means, stds = permutation(model, x, truth, seed, 10)
    else:
        features, means, stds = _grouped(model, x, truth, list(model.features_), words, seed, 10)
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


def _grouped(
    model: Any,
    x: Any,
    y: Any,
    columns: list[str],
    words: Words,
    seed: int,
    repeats: int,
) -> tuple[list[str], np.ndarray, np.ndarray]:
    """Permutation importance by group: each table column alone, and each text column's words
    together under its column's name, since one word of 50,000 says little and shuffling each
    is too slow. scikit-learn shuffles columns, so it shuffles a matrix of row positions, one
    column per group, and each group's block is read at its shuffled rows."""
    groups = [(c, [i]) for i, c in enumerate(columns)]
    by_source: dict[str, list[int]] = {}
    for i, name in enumerate(words[1], start=len(columns)):
        # Words are named `<column>:<word>` and a word holds no colon; a column name may.
        by_source.setdefault(name.rsplit(":", 1)[0], []).append(i)
    groups += list(by_source.items())
    x = sparse.csc_array(x)
    blocks = [sparse.csr_array(x[:, idx]) for _, idx in groups]
    order = np.argsort(np.concatenate([idx for _, idx in groups]))
    positions = np.tile(np.arange(x.shape[0])[:, None], (1, len(groups)))

    def score(estimator: Any, at: np.ndarray, truth: Any) -> float:
        read = [block[at[:, g], :] for g, block in enumerate(blocks)]
        return float(estimator.score(sparse.hstack(read, format="csc")[:, order], truth))

    result = permutation_importance(
        model, positions, y, scoring=score, n_repeats=repeats, random_state=seed
    )
    return [name for name, _ in groups], result.importances_mean, result.importances_std


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
