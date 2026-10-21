"""What a two-class model's mistakes cost, and a model that sets its cut-off by them
(ADR-0053)."""

from typing import Any

import numpy as np
from sklearn import metrics, model_selection
from sklearn.dummy import DummyClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.model_selection import FixedThresholdClassifier, TunedThresholdClassifierCV
from sklearn.pipeline import Pipeline

# Folds of the model's own training rows that its cut-off is tuned on.
INNER_FOLDS = 3


def expected_cost(
    y_true: Any, y_pred: Any, pos_label: Any, false_negative: float, false_positive: float
) -> float:
    """Mean cost per row: a missed `pos_label` costs `false_negative`, a false alarm
    `false_positive`, a right prediction nothing."""
    truth = np.asarray(y_true) == pos_label
    said = np.asarray(y_pred) == pos_label
    missed, alarms = (truth & ~said).sum(), (~truth & said).sum()
    return float((false_negative * missed + false_positive * alarms) / len(truth))


def resolved(costs: dict[str, Any], truth: np.ndarray, target: str) -> dict[str, Any]:
    """`costs` with `positive` as the class value it names by its text."""
    classes = {str(c): c for c in np.unique(truth)}
    if len(classes) != 2:
        raise ValueError(f"costs need two classes; {target} has {len(classes)}")
    if costs["positive"] not in classes:
        raise ValueError(f"{costs['positive']!r} is not one of the 2 classes of {target}")
    return {**costs, "positive": classes[costs["positive"]]}


def scorer(costs: dict[str, Any]) -> Any:
    """Named `pos_label`, the class is the one whose probability a tuned cut-off is set on."""
    return metrics.make_scorer(
        expected_cost,
        greater_is_better=False,
        pos_label=costs["positive"],
        false_negative=costs["false_negative"],
        false_positive=costs["false_positive"],
    )


def costed(model: Pipeline, costs: dict[str, Any], seed: int) -> Any:
    """`model` deciding by `costs`, whose `positive` is a class value.

    A model is tuned for least cost on inner folds of its own training rows, on its scores, so
    its probabilities need not be calibrated. A dummy cannot be tuned, since its scores are
    constant: it predicts `positive` when its share of the training rows is at least
    c_FP / (c_FP + c_FN), which is the cheaper of approving and refusing everyone."""
    positive = costs["positive"]
    if isinstance(model[-1], DummyClassifier):
        model.set_params(**{f"{model.steps[-1][0]}__strategy": "prior"})
        at = costs["false_positive"] / (costs["false_positive"] + costs["false_negative"])
        return FixedThresholdClassifier(model, threshold=at, pos_label=positive)
    folds = model_selection.StratifiedKFold(INNER_FOLDS, shuffle=True, random_state=seed)
    return TunedThresholdClassifierCV(model, scoring=scorer(costs), cv=folds)


def fixed(model: Any, x: Any, y: np.ndarray, positive: Any) -> Any:
    """A fitted tuned model as its pipeline and the cut-off it chose for `positive`. A saved
    model then holds no scorer, whose function a model file could otherwise name and call."""
    if not isinstance(model, TunedThresholdClassifierCV):
        return model
    at = float(model.best_threshold_)
    frozen = FrozenEstimator(model.estimator_)
    return FixedThresholdClassifier(frozen, threshold=at, pos_label=positive).fit(x, y)
