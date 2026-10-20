"""Compare shortlisted models by cross-validation on the split's train rows (ADR-0044). The
test rows are never an input: they stay for the chosen model's final evaluation."""

import hashlib
import math
from collections.abc import Callable
from typing import Any

import numpy as np
import polars as pl
from sklearn import model_selection
from sklearn.base import BaseEstimator

METRIC_OF_TASK = {"classification": "balanced_accuracy", "regression": "rmse"}
SCORING = {"balanced_accuracy": "balanced_accuracy", "rmse": "neg_root_mean_squared_error"}
GREATER_IS_BETTER = {"balanced_accuracy": True, "rmse": False}
LABEL = {"balanced_accuracy": "balanced accuracy", "rmse": "RMSE"}
# What every candidate's folds must share for their paired differences to mean anything.
PROTOCOL = ["metric", "folds", "seed", "fold", "train_rows", "validate_rows", "rows_digest"]


def cross_validate(
    train: pl.DataFrame,
    candidate: Callable[..., BaseEstimator],
    candidate_params: dict[str, Any],
    folds: int,
    seed: int,
    metric: str,
) -> pl.DataFrame:
    """One row per fold: the candidate's score on that fold's validation rows. Its whole
    pipeline, preparation included, is refit on the other rows of each fold. The same rows,
    folds and seed give every candidate the same folds."""
    target, features, task = (candidate_params[k] for k in ("target", "features", "task"))
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
    settings = {k: v for k, v in candidate_params.items() if k not in ("target", "features")}
    model = candidate(schema=x.schema, **settings)
    splits = list(_splitter(task, y, folds, seed).split(np.zeros(len(y)), y.to_numpy()))
    result = model_selection.cross_validate(
        model, x, y.to_numpy(), cv=splits, scoring=SCORING[metric], error_score="raise"
    )
    sign = 1.0 if GREATER_IS_BETTER[metric] else -1.0
    return pl.DataFrame(
        {
            "metric": [metric] * folds,
            "folds": [folds] * folds,
            "seed": [seed] * folds,
            "fold": list(range(1, folds + 1)),
            "score": (sign * result["test_score"]).tolist(),
            "train_rows": [len(fit_rows) for fit_rows, _ in splits],
            "validate_rows": [len(held) for _, held in splits],
            "rows_digest": [_digest(held) for _, held in splits],
        }
    )


def _splitter(task: str, y: pl.Series, folds: int, seed: int) -> model_selection.BaseCrossValidator:
    if task != "classification":
        return model_selection.KFold(folds, shuffle=True, random_state=seed)
    # A class with fewer rows than folds leaves some folds without it.
    counts = y.value_counts(name="rows").sort("rows")
    if counts["rows"][0] < folds:
        raise ValueError(
            f"class {counts[y.name][0]!r} has {counts['rows'][0]} train rows; "
            f"{folds} folds need at least {folds} of each class"
        )
    return model_selection.StratifiedKFold(folds, shuffle=True, random_state=seed)


def _digest(rows: np.ndarray) -> str:
    return "sha256:" + hashlib.sha256(np.asarray(rows, dtype=np.int64).tobytes()).hexdigest()


def select_model(
    trials: dict[str, pl.DataFrame], baseline: str, metric: str, not_compared: list[str]
) -> dict[str, Any]:
    """A SelectionDecision: the candidate with the best mean score among those that beat the
    baseline on the same folds, or none. Beating it means a mean paired improvement larger
    than its standard error, corrected for folds that share train rows (Nadeau & Bengio 2003:
    the variance of the mean is (1/k + n_validate/n_train) times the variance of the
    differences, not 1/k)."""
    if baseline not in trials:
        raise ValueError(f"baseline {baseline} is not one of the trials {sorted(trials)}")
    protocol = trials[baseline].select(PROTOCOL)
    for name, trial in trials.items():
        if not trial.select(PROTOCOL).equals(protocol):
            raise ValueError(f"{name} was not scored on the same folds as {baseline}")
    if protocol["metric"][0] != metric:
        raise ValueError(f"trials were scored by {protocol['metric'][0]}, not {metric}")
    k = protocol.height
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
            se = math.sqrt((1 / k + ratio) * float(gain.var(ddof=1)))
            result["versus_baseline"] = {
                "mean_difference": float(gain.mean()),
                "corrected_se": se,
                "beats_baseline": bool(gain.mean() > se),
            }
        candidates.append(result)

    beating = [c for c in candidates if c.get("versus_baseline", {}).get("beats_baseline")]
    decision: dict[str, Any] = {
        "schema_version": "sprisk.selection_decision/v1",
        "metric": metric,
        "folds": k,
        "seed": int(protocol["seed"][0]),
        "baseline": baseline,
        "candidates": candidates,
        "limitations": [
            f"Steps {', '.join(not_compared)} between the split and the model were not part "
            "of the comparison: every candidate was scored on the split's train rows without them."
        ]
        if not_compared
        else [],
    }
    if not beating:
        decision["reason"] = (
            f"No model beats the baseline: none improves on {baseline}'s {LABEL[metric]} by more "
            f"than the corrected standard error of its paired differences over the same {k} folds."
        )
        return decision
    # Ties go to the first by id, so the same scores always give the same winner.
    winner = max(beating, key=lambda c: sign * c["mean"])
    versus = winner["versus_baseline"]
    decision["winner"] = winner["id"]
    decision["reason"] = (
        f"{winner['id']} has the best mean {LABEL[metric]} ({winner['mean']:.3f} ± "
        f"{winner['spread']:.3f}) of the models that beat the baseline. Over the same {k} folds "
        f"it improves on {baseline} by {versus['mean_difference']:.3f}, more than the corrected "
        f"standard error {versus['corrected_se']:.3f}."
    )
    return decision
