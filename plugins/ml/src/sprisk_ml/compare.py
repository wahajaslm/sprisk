"""Compare shortlisted models by cross-validation on the split's train rows (ADR-0044). The
test rows are never an input: they stay for the chosen model's final evaluation."""

import hashlib
import math
from collections.abc import Callable
from typing import Any

import numpy as np
import plotly.graph_objects as go
import polars as pl
from scipy import stats
from sklearn import metrics, model_selection
from sklearn.base import BaseEstimator

from .evaluate import confusion_figure, predicted_figure
from .importance import importance_figure, permutation

METRIC_OF_TASK = {"classification": "balanced_accuracy", "regression": "rmse"}
SCORING = {"balanced_accuracy": "balanced_accuracy", "rmse": "neg_root_mean_squared_error"}
GREATER_IS_BETTER = {"balanced_accuracy": True, "rmse": False}
LABEL = {"balanced_accuracy": "balanced accuracy", "rmse": "RMSE"}
# Shuffles per feature and fold; with five folds, 25 per feature in all.
IMPORTANCE_REPEATS = 5
ALPHA = 0.05
TESTED = (
    "Beating the baseline means a corrected repeated k-fold t-test (Bouckaert & Frank 2004) "
    "rejects 'no better than the baseline' at α = 0.05 after a Holm adjustment over the "
    "candidates. Folds share rows, so the test is approximate."
)
# What every candidate's folds must share for their paired differences to mean anything.
PROTOCOL = [
    "metric",
    "folds",
    "seed",
    "repeat",
    "fold",
    "train_rows",
    "validate_rows",
    "rows_digest",
]


def cross_validate(
    train: pl.DataFrame,
    candidate: Callable[..., BaseEstimator],
    candidate_params: dict[str, Any],
    folds: int,
    seed: int,
    metric: str,
    repeats: int,
) -> dict[str, Any]:
    """The candidate's score on each fold's validation rows, its whole pipeline, preparation
    included, refit on the fold's other rows; the rows are shuffled into folds `repeats` times.
    The same rows, folds, repeats and seed give every candidate the same folds. Also what it
    predicted for each train row while the first repeat held it out, how much each feature
    mattered on those held-out folds, and figures of both: all from the train rows, so looking
    at them never touches the test rows (ADR-0047)."""
    target, features, task = (candidate_params[k] for k in ("target", "features", "task"))
    # Rust picks the metric from the question's task; this checks a step built by hand.
    if task not in METRIC_OF_TASK:
        raise ValueError(f"a {task} task has no comparison metric")
    if METRIC_OF_TASK[task] != metric:
        raise ValueError(
            f"metric {metric} does not fit a {task} task; it is {METRIC_OF_TASK[task]}"
        )
    if target in features:
        raise ValueError(f"target {target!r} is listed as a feature")
    y = train[target]
    if y.null_count():
        raise ValueError(f"{target} has {y.null_count()} missing values in train")
    x = train.select(features)
    truth = y.to_numpy()
    settings = {k: v for k, v in candidate_params.items() if k not in ("target", "features")}
    model = candidate(schema=x.schema, **settings)
    splits = list(_splitter(task, y, folds, repeats, seed).split(np.zeros(len(y)), truth))
    result = model_selection.cross_validate(
        model,
        x,
        truth,
        cv=splits,
        scoring=SCORING[metric],
        error_score="raise",
        return_estimator=True,
    )
    sign = 1.0 if GREATER_IS_BETTER[metric] else -1.0
    scorer = metrics.get_scorer(SCORING[metric])
    held_out, fold_of, predicted, importances = [], [], [], []
    first = zip(splits[:folds], result["estimator"][:folds], strict=True)
    for fold, ((_, held), fitted) in enumerate(first, 1):
        rows = x[held]
        held_out += held.tolist()
        fold_of += [fold] * len(held)
        predicted += fitted.predict(rows).tolist()
        means, _ = permutation(fitted, rows, truth[held], seed, IMPORTANCE_REPEATS, scorer)
        importances.append(means)
    by_fold = np.array(importances)
    importance = pl.DataFrame(
        {
            "feature": features,
            "importance": by_fold.mean(axis=0),
            "spread": by_fold.std(axis=0, ddof=1),
        }
    ).sort("importance", descending=True)
    predictions = pl.DataFrame(
        {"row": held_out, "fold": fold_of, "actual": truth[held_out], "predicted": predicted}
    )
    n = folds * repeats
    scores = pl.DataFrame(
        {
            "metric": [metric] * n,
            "folds": [folds] * n,
            "seed": [seed] * n,
            "repeat": [1 + i // folds for i in range(n)],
            "fold": [1 + i % folds for i in range(n)],
            "score": (sign * result["test_score"]).tolist(),
            "train_rows": [len(fit_rows) for fit_rows, _ in splits],
            "validate_rows": [len(held) for _, held in splits],
            "rows_digest": [_digest(held) for _, held in splits],
        }
    )
    return {
        "scores": scores,
        "predictions": predictions,
        "importance": importance,
        "figures": [_fit_figure(task, predictions), _importance_figure(importance)],
    }


def _fit_figure(task: str, predictions: pl.DataFrame) -> go.Figure:
    actual, predicted = predictions["actual"].to_list(), predictions["predicted"].to_list()
    if task == "classification":
        labels = sorted({*actual, *predicted})
        matrix = metrics.confusion_matrix(actual, predicted, labels=labels).tolist()
        figure = confusion_figure([str(v) for v in labels], matrix)
        title = "Out-of-fold confusion matrix (train rows)"
    else:
        figure = predicted_figure(actual, predicted, "target")
        title = "Out-of-fold predicted against actual (train rows)"
    return figure.update_layout(title={"text": title})


def _importance_figure(importance: pl.DataFrame) -> go.Figure:
    return importance_figure(
        importance["feature"].to_list(),
        importance["importance"].to_list(),
        importance["spread"].to_list(),
        "Permutation importance on held-out folds (predictive, not causal)",
    )


def _splitter(
    task: str, y: pl.Series, folds: int, repeats: int, seed: int
) -> model_selection.BaseCrossValidator:
    if task != "classification":
        return model_selection.RepeatedKFold(n_splits=folds, n_repeats=repeats, random_state=seed)
    # A class with fewer rows than folds leaves some folds without it.
    counts = y.value_counts(name="rows").sort("rows")
    if counts["rows"][0] < folds:
        raise ValueError(
            f"class {counts[y.name][0]!r} has {counts['rows'][0]} train rows; "
            f"{folds} folds need at least {folds} of each class"
        )
    return model_selection.RepeatedStratifiedKFold(
        n_splits=folds, n_repeats=repeats, random_state=seed
    )


def _digest(rows: np.ndarray) -> str:
    return "sha256:" + hashlib.sha256(np.asarray(rows, dtype=np.int64).tobytes()).hexdigest()


def select_model(
    trials: dict[str, pl.DataFrame],
    baseline: str,
    metric: str,
    not_compared: list[str],
    complexity: dict[str, int],
) -> dict[str, Any]:
    """A SelectionDecision (ADR-0047). Of the candidates that beat the baseline on the same
    folds, the simplest whose mean is within one standard error of the best mean wins: the
    one-SE rule (Breiman et al. 1984; ESL §7.10). Beating the baseline means the corrected
    repeated k-fold t-test (Bouckaert & Frank 2004) rejects "no better than the baseline",
    one-sided at α = 0.05, after a Holm adjustment over the candidates. Both standard errors
    are corrected for folds that share train rows: the variance of a mean of n fold values
    is (1/n + n_validate/n_train) times their variance, not 1/n. That is the correction of
    Nadeau & Bengio (2003), applied to repeated k-fold as Bouckaert & Frank do."""
    if baseline not in trials:
        raise ValueError(f"baseline {baseline} is not one of the trials {sorted(trials)}")
    if missing := sorted(set(trials) - set(complexity)):
        raise ValueError(f"no complexity for {missing}")
    protocol = trials[baseline].select(PROTOCOL)
    for name, trial in trials.items():
        if not trial.select(PROTOCOL).equals(protocol):
            raise ValueError(f"{name} was not scored on the same folds as {baseline}")
    if protocol["metric"][0] != metric:
        raise ValueError(f"trials were scored by {protocol['metric'][0]}, not {metric}")
    k = protocol.height
    repeats = int(protocol["repeat"].max())  # type: ignore[arg-type]
    ratio = float((protocol["validate_rows"] / protocol["train_rows"]).mean())  # type: ignore[arg-type]
    sign = 1.0 if GREATER_IS_BETTER[metric] else -1.0
    floor = trials[baseline]["score"].to_numpy()

    candidates = []
    for name in sorted(trials):
        scores = trials[name]["score"].to_numpy()
        result: dict[str, Any] = {
            "id": name,
            "fold_scores": scores.tolist(),
            "mean": float(scores.mean()),
            "spread": float(scores.std(ddof=1)),
        }
        if name != baseline:
            gain = sign * (scores - floor)
            se = _corrected_se(gain, k, ratio)
            result["versus_baseline"] = {
                "mean_difference": float(gain.mean()),
                "corrected_se": se,
                "p_value": _one_sided_p(float(gain.mean()), se, k - 1),
            }
        candidates.append(result)
    _holm([c["versus_baseline"] for c in candidates if "versus_baseline" in c])

    beating = [c for c in candidates if c.get("versus_baseline", {}).get("beats_baseline")]
    left_out = (
        [
            f"Steps {', '.join(not_compared)} between the split and the model were not part "
            "of the comparison: every candidate was scored on the split's train rows without them."
        ]
        if not_compared
        else []
    )
    decision: dict[str, Any] = {
        "schema_version": "sprisk.selection_decision/v1",
        "metric": metric,
        "folds": int(protocol["folds"][0]),
        "repeats": repeats,
        "seed": int(protocol["seed"][0]),
        "baseline": baseline,
        "candidates": candidates,
        "limitations": [*left_out, TESTED],
    }
    if not beating:
        decision["reason"] = (
            f"No model beats the baseline: none passes the corrected t-test against {baseline}'s "
            f"{LABEL[metric]} at α = {ALPHA} after a Holm adjustment, over the same {k} folds."
        )
        return decision
    best = max(beating, key=lambda c: sign * c["mean"])
    best_se = _corrected_se(trials[best["id"]]["score"].to_numpy(), k, ratio)
    near = [c for c in beating if sign * (best["mean"] - c["mean"]) <= best_se]
    # Ties of complexity go to the better mean, then the id, so the same scores always give
    # the same winner.
    winner = min(near, key=lambda c: (complexity[c["id"]], -sign * c["mean"], c["id"]))
    decision["winner"] = winner["id"]
    if len(near) > 1:
        decision["reason"] = (
            f"{' and '.join(c['id'] for c in near)} are within one standard error "
            f"({best_se:.3f}) of the best mean {LABEL[metric]} ({best['mean']:.3f}) and beat the "
            f"baseline. {winner['id']} is the simplest of them, so the more flexible models add "
            "no measurable gain on these rows."
        )
        return decision
    versus = winner["versus_baseline"]
    decision["reason"] = (
        f"{winner['id']} has the best mean {LABEL[metric]} ({winner['mean']:.3f} ± "
        f"{winner['spread']:.3f}) of the models that beat the baseline, and no simpler model is "
        f"within one standard error of it. Over the same {k} folds it improves on {baseline} by "
        f"{versus['mean_difference']:.3f} (corrected standard error {versus['corrected_se']:.3f}, "
        f"one-sided p = {versus['p_value']:.2g})."
    )
    return decision


def _corrected_se(values: np.ndarray, k: int, ratio: float) -> float:
    """Standard error of the mean of `values`, one per fold, corrected for overlapping folds."""
    return math.sqrt((1 / k + ratio) * float(values.var(ddof=1)))


def _one_sided_p(mean: float, se: float, df: int) -> float:
    """p that a mean gain this large arises when the model is no better than the baseline."""
    if se == 0:
        # Every fold gained the same: a real gain is certain, none is no evidence.
        return 0.0 if mean > 0 else 1.0
    return float(stats.t.sf(mean / se, df))


def _holm(comparisons: list[dict[str, Any]]) -> None:
    """Holm's step-down adjustment: the i-th smallest p must be at most α / (m - i)."""
    for c in comparisons:
        c["beats_baseline"] = False
    ordered = sorted(comparisons, key=lambda c: c["p_value"])
    for i, c in enumerate(ordered):
        if c["p_value"] > ALPHA / (len(ordered) - i):
            break
        c["beats_baseline"] = True
