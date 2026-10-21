"""Compare shortlisted models by cross-validation on the split's train rows (ADR-0044). The
test rows are never an input: they stay for the chosen model's final evaluation."""

import hashlib
import math
from collections.abc import Callable
from typing import Any, Literal

import numpy as np
import plotly.graph_objects as go
import polars as pl
from scipy import stats
from sklearn import metrics, model_selection
from sklearn.base import BaseEstimator
from sklearn.pipeline import Pipeline

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
TESTED_REFERENCE = (
    "Beating the recommendation means a corrected repeated k-fold t-test (Bouckaert & Frank "
    "2004) rejects 'no better than the recommendation' at α = 0.05 after a Holm adjustment "
    "over the alternatives. Folds share rows, so the test is approximate."
)
ONE_STEP = (
    "Only this step changed: the model and the other steps were as the flow has them, so the "
    "choice holds for this model, not for every model."
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
    "folds_by",
]
TIME_ORDERED = (
    "Folds follow time, so they are not exchangeable: the corrected t-test is a rough guide "
    "here, not an exact test."
)


def cross_validate(
    train: pl.DataFrame,
    candidate: Callable[..., BaseEstimator],
    candidate_params: dict[str, Any],
    folds: int,
    seed: int,
    metric: str,
    repeats: int,
    prepare: list[Any],
    time_column: str | None = None,
    group_column: str | None = None,
) -> dict[str, Any]:
    """The candidate's score on each fold's validation rows, its whole pipeline, preparation
    included, refit on the fold's other rows; the rows are shuffled into folds `repeats` times.
    The same rows, folds, repeats and seed give every candidate the same folds. Also what it
    predicted for each train row while the first repeat held it out, how much each feature
    mattered on those held-out folds, and figures of both: all from the train rows, so looking
    at them never touches the test rows (ADR-0047). `prepare` are the preparation steps between
    the split and the model, as transformers; each fold refits them before the model.

    After a time split, folds follow `time_column`: each validates on rows no earlier than
    any it fits on (rows sharing a time may fall on both sides), and the earliest rows are
    only fit on. After a group split, no `group_column`
    value is on both sides of a fold. Otherwise rows are shuffled (ADR-0047)."""
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
    truth = y.to_numpy()
    settings = {k: v for k, v in candidate_params.items() if k not in ("target", "features")}
    # The model sees the feature columns' types before preparation; filling and rescaling
    # keep numbers numbers and text text.
    model = candidate(schema=train.select(features).schema, **settings)
    # Preparation may read columns the model does not, so it gets every column but the target.
    x = train.drop(target) if prepare else train.select(features)
    if prepare:
        steps = [(f"prepare_{i}", step) for i, step in enumerate(prepare)]
        model = Pipeline([*steps, ("model", model)])
    if time_column is not None and group_column is not None:
        raise ValueError("folds follow time or groups, not both")
    if time_column is not None:
        splits, folds_by = _time_splits(train, time_column, folds, repeats), "time"
    elif group_column is not None:
        groups = train[group_column]
        if groups.null_count():
            raise ValueError(f"{group_column} has {groups.null_count()} missing values in train")
        splits = _group_splits(task, truth, groups.to_numpy(), folds, repeats, seed)
        folds_by = "group"
    else:
        splitter = _splitter(task, y, folds, repeats, seed)
        splits, folds_by = list(splitter.split(np.zeros(len(y)), truth)), "shuffle"
    run = {"scoring": SCORING[metric], "error_score": "raise"}
    # Only the first repeat's fitted pipelines feed the diagnostics; the rest are not kept.
    shown = model_selection.cross_validate(
        model, x, truth, cv=splits[:folds], return_estimator=True, **run
    )
    later = splits[folds:]
    rest = model_selection.cross_validate(model, x, truth, cv=later, **run) if later else None
    test_score = np.concatenate([shown["test_score"], rest["test_score"] if rest else np.array([])])
    sign = 1.0 if GREATER_IS_BETTER[metric] else -1.0
    scorer = metrics.get_scorer(SCORING[metric])
    held_out, fold_of, predicted, importances = [], [], [], []
    first = zip(splits[:folds], shown["estimator"], strict=True)
    for fold, ((_, held), fitted) in enumerate(first, 1):
        rows = x[held]
        held_out += held.tolist()
        fold_of += [fold] * len(held)
        predicted += fitted.predict(rows).tolist()
        means, _ = permutation(fitted, rows, truth[held], seed, IMPORTANCE_REPEATS, scorer)
        by_name = dict(zip(x.columns, means, strict=True))
        importances.append([by_name[f] for f in features])
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
            "score": (sign * test_score).tolist(),
            "train_rows": [len(fit_rows) for fit_rows, _ in splits],
            "validate_rows": [len(held) for _, held in splits],
            "rows_digest": [_digest(held) for _, held in splits],
            "folds_by": [folds_by] * n,
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


def _time_splits(
    train: pl.DataFrame, column: str, folds: int, repeats: int
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Expanding-window folds over the rows in `column` order, as row indices of `train`."""
    if repeats != 1:
        raise ValueError("time-ordered folds cannot be reshuffled; repeats must be 1")
    times = train[column]
    if times.null_count():
        raise ValueError(f"{column} has {times.null_count()} missing values in train")
    order = np.argsort(times.to_numpy(), kind="stable")
    windows = model_selection.TimeSeriesSplit(n_splits=folds).split(order)
    return [(order[fit], order[held]) for fit, held in windows]


def _group_splits(
    task: str, truth: np.ndarray, groups: np.ndarray, folds: int, repeats: int, seed: int
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Folds that keep each group whole, shuffled anew for each repeat."""
    splits: list[tuple[np.ndarray, np.ndarray]] = []
    for repeat in range(repeats):
        shuffle = {"n_splits": folds, "shuffle": True, "random_state": seed + repeat}
        splitter = (
            model_selection.StratifiedGroupKFold(**shuffle)
            if task == "classification"
            else model_selection.GroupKFold(**shuffle)
        )
        splits += list(splitter.split(np.zeros(len(truth)), truth, groups))
    return splits


def _digest(rows: np.ndarray) -> str:
    return "sha256:" + hashlib.sha256(np.asarray(rows, dtype=np.int64).tobytes()).hexdigest()


def select_model(
    trials: dict[str, pl.DataFrame],
    baseline: str,
    metric: str,
    complexity: dict[str, int],
    baseline_role: Literal["floor", "reference"],
    not_compared: list[dict[str, str]],
) -> dict[str, Any]:
    """A SelectionDecision (ADR-0047). Of the candidates that beat the baseline on the same
    folds, the simplest whose mean is within one standard error of the best mean wins: the
    one-SE rule (Breiman et al. 1984; ESL §7.10). A `floor` baseline, a model that ignores its
    features, never wins; a `reference` baseline, the rule's recommended preparation, wins
    when no alternative beats it. `not_compared` is recorded as given. Beating the baseline
    means the corrected repeated k-fold t-test (Bouckaert & Frank 2004) rejects "no better
    than the baseline", one-sided at α = 0.05, after a Holm adjustment over the candidates.
    Both standard errors are corrected for folds that share train rows: the variance of a
    mean of n fold values is (1/n + n_validate/n_train) times their variance, not 1/n. That
    is the correction of Nadeau & Bengio (2003), applied to repeated k-fold as Bouckaert &
    Frank do."""
    if both := sorted(set(trials) & {n["id"] for n in not_compared}):
        raise ValueError(f"{', '.join(both)} is both a trial and not compared")
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
    reference = baseline_role == "reference"
    tested = [TESTED_REFERENCE, ONE_STEP] if reference else [TESTED]
    decision: dict[str, Any] = {
        "schema_version": "sprisk.selection_decision/v1",
        "metric": metric,
        "folds": int(protocol["folds"][0]),
        "repeats": repeats,
        "seed": int(protocol["seed"][0]),
        "baseline": baseline,
        "baseline_role": baseline_role,
        "candidates": candidates,
        "not_compared": not_compared,
        "limitations": [*tested, *([TIME_ORDERED] if protocol["folds_by"][0] == "time" else [])],
    }
    if not beating and reference:
        decision["winner"] = baseline
        decision["reason"] = (
            f"No alternative beats the recommendation {baseline}: none passes the corrected "
            f"t-test against its {LABEL[metric]} at α = {ALPHA} after a Holm adjustment, over "
            f"the same {k} folds. {baseline} stands."
        )
        return decision
    if not beating:
        decision["reason"] = (
            f"No model beats the baseline: none passes the corrected t-test against {baseline}'s "
            f"{LABEL[metric]} at α = {ALPHA} after a Holm adjustment, over the same {k} folds."
        )
        return decision
    kind, against = (
        ("alternative", "the recommendation") if reference else ("model", "the baseline")
    )
    others = "others" if reference else "more flexible ones"
    best = max(beating, key=lambda c: sign * c["mean"])
    best_se = _corrected_se(trials[best["id"]]["score"].to_numpy(), k, ratio)
    near = [c for c in beating if sign * (best["mean"] - c["mean"]) <= best_se]
    # Ties of complexity go to the better mean, then the id, so the same scores always give
    # the same winner.
    winner = min(near, key=lambda c: (complexity[c["id"]], -sign * c["mean"], c["id"]))
    decision["winner"] = winner["id"]
    if len(near) > 1:
        equally_simple = len({complexity[c["id"]] for c in near}) == 1
        then = (
            f"They are equally simple, so {winner['id']}, with the best mean, is recommended."
            if equally_simple
            else f"{winner['id']} is the simplest of them; the extra gain of the {others} is "
            "within one standard error, so it is not counted."
        )
        decision["reason"] = (
            f"{' and '.join(c['id'] for c in near)} are within one standard error "
            f"({best_se:.3f}) of the best mean {LABEL[metric]} ({best['mean']:.3f}) and beat "
            f"{against}. {then}"
        )
        return decision
    versus = winner["versus_baseline"]
    decision["reason"] = (
        f"{winner['id']} has the best mean {LABEL[metric]} ({winner['mean']:.3f} ± "
        f"{winner['spread']:.3f}) of the {kind}s that beat {against}, and no simpler {kind} "
        f"that beats {against} is within one standard error of it. Over the same {k} folds it "
        f"improves on {baseline} by "
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
