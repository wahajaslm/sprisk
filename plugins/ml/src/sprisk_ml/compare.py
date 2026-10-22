"""Compare shortlisted models by cross-validation on the split's train rows (ADR-0044). The
test rows are never an input: they stay for the chosen model's final evaluation."""

import hashlib
import math
from collections.abc import Callable
from functools import partial
from typing import Any, Literal

import numpy as np
import plotly.graph_objects as go
import polars as pl
from scipy import stats
from sklearn import metrics, model_selection
from sklearn.base import BaseEstimator
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer

from .costs import costed, resolved, scorer
from .evaluate import confusion_figure, predicted_figure
from .importance import importance_figure, permutation
from .models import model_input

METRIC_OF_TASK = {"classification": "balanced_accuracy", "regression": "rmse"}
SCORING = {"balanced_accuracy": "balanced_accuracy", "rmse": "neg_root_mean_squared_error"}
GREATER_IS_BETTER = {"balanced_accuracy": True, "expected_cost": False, "rmse": False}
LABEL = {"balanced_accuracy": "balanced accuracy", "expected_cost": "expected cost", "rmse": "RMSE"}
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
TUNED = (
    "Each tuned model's fold score comes from the setting its inner folds chose on that fold's "
    "training rows, so it describes the tuning, not one fixed setting. Settings were tuned on "
    "{metric} only, not on any guardrail."
)
AT_SHARE = (
    "Expected cost and each model's cut-off hold where {share:.0%} of the train rows are "
    "{positive}, as here; at another share of {positive} rows both shift."
)
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
    inner_folds: int | None = None,
    recall_of: list[str] | None = None,
) -> dict[str, Any]:
    """The candidate's score on each fold's validation rows, its whole pipeline, preparation
    included, refit on the fold's other rows; the rows are shuffled into folds `repeats` times.
    The same rows, folds, repeats and seed give every candidate the same folds. Also what it
    predicted for each train row while the first repeat held it out, how much each column
    mattered on those held-out folds, and figures of both: all from the train rows, so looking
    at them never touches the test rows (ADR-0050). `prepare` are the preparation steps between
    the split and the model, as transformers; each fold refits them before the model, which
    takes its features from what they make (ADR-0056).

    After a time split, folds follow `time_column`: each validates on rows no earlier than
    any it fits on (rows sharing a time may fall on both sides), and the earliest rows are
    only fit on. After a group split, no `group_column`
    value is on both sides of a fold. Otherwise rows are shuffled (ADR-0050).

    With `inner_folds`, a trial of a study (ADR-0052): each outer fold also scores the
    candidate on that many inner folds of its own training rows (`inner_score`), and all the
    train rows are scored the same way once (`train_inner_score`), so the select step can tune
    without an outer validation row. Inner folds keep what the outer ones keep: classes, time
    order or whole groups. `recall_of` adds, per outer fold, the recall of each named class
    (`recall_0`, ...), for guardrails.

    A candidate whose params state `costs` (ADR-0053) is scored by expected cost. Its whole
    pipeline, preparation included, tunes its cut-off on inner folds of each fold's training
    rows. The model step tunes its own on all train rows after the flow's preparation, which
    was fit on all of them, so its cut-off's folds share that preparation."""
    target, task = candidate_params["target"], candidate_params["task"]
    features, costs = candidate_params.get("features"), candidate_params.get("costs")
    exclude = candidate_params.get("exclude", [])
    # Rust picks the metric from the question's task and the step's costs; this checks a
    # step built by hand.
    if task not in METRIC_OF_TASK:
        raise ValueError(f"a {task} task has no comparison metric")
    if costs is not None and metric != "expected_cost":
        raise ValueError(f"costs are scored by expected_cost, not {metric}")
    if costs is None and metric == "expected_cost":
        raise ValueError("expected_cost needs the model step's costs")
    if costs is None and METRIC_OF_TASK[task] != metric:
        raise ValueError(
            f"metric {metric} does not fit a {task} task; it is {METRIC_OF_TASK[task]}"
        )
    if features is not None and target in features:
        raise ValueError(f"target {target!r} is listed as a feature")
    y = train[target]
    if y.null_count():
        raise ValueError(f"{target} has {y.null_count()} missing values in train")
    truth = y.to_numpy()
    settings = {
        k: v
        for k, v in candidate_params.items()
        if k not in ("target", "features", "costs", "exclude")
    }
    # Preparation may read columns the model does not, so it gets every column but the target
    # and the key columns, which identify rows, groups or time and are never inputs. A key
    # column an earlier step dropped is already left out, as in the model step.
    left_out = [target, *exclude]
    x = (
        train.drop(left_out, strict=False)
        if prepare or features is None
        else train.select(features)
    )
    model = Pipeline(
        [
            *[(f"prepare_{i}", step) for i, step in enumerate(prepare)],
            ("input", FunctionTransformer(model_input, kw_args={"features": features})),
            ("model", candidate(**settings)),
        ]
    )
    if time_column is not None and group_column is not None:
        raise ValueError("folds follow time or groups, not both")
    if costs is not None:
        if time_column is not None or group_column is not None:
            raise ValueError(
                "costs need folds that are shuffled rows: after a time or group split, the "
                "cut-off's inner folds would not keep time order or whole groups"
            )
        positive = costs["positive"]
        costs = resolved(costs, truth, target)
        model = costed(model, costs, settings.get("seed", 0))
    groups = None
    if time_column is not None:
        splits, folds_by = _time_splits(train, time_column, folds, repeats), "time"
    elif group_column is not None:
        group_values = train[group_column]
        if group_values.null_count():
            raise ValueError(
                f"{group_column} has {group_values.null_count()} missing values in train"
            )
        groups = group_values.to_numpy()
        splits = _group_splits(task, truth, groups, folds, repeats, seed)
        folds_by = "group"
    else:
        splitter = _splitter(task, y, folds, repeats, seed)
        splits, folds_by = list(splitter.split(np.zeros(len(y)), truth)), "shuffle"
    score = scorer(costs) if costs is not None else SCORING[metric]
    scoring: dict[str, Any] = {"score": score}
    recalls = _recall_scorers(task, target, truth, recall_of or [])
    scoring.update(recalls)
    run = {"scoring": scoring, "error_score": "raise"}
    # Only the first repeat's fitted pipelines feed the diagnostics; the rest are not kept.
    shown = model_selection.cross_validate(
        model, x, truth, cv=splits[:folds], return_estimator=True, **run
    )
    later = splits[folds:]
    rest = model_selection.cross_validate(model, x, truth, cv=later, **run) if later else None
    test_score = np.concatenate([shown["test_score"], rest["test_score"] if rest else np.array([])])
    sign = 1.0 if GREATER_IS_BETTER[metric] else -1.0
    by_metric = metrics.get_scorer(score)
    held_out, fold_of, predicted, importances = [], [], [], []
    first = zip(splits[:folds], shown["estimator"], strict=True)
    for fold, ((_, held), fitted) in enumerate(first, 1):
        rows = x[held]
        held_out += held.tolist()
        fold_of += [fold] * len(held)
        predicted += fitted.predict(rows).tolist()
        means, _ = permutation(fitted, rows, truth[held], seed, IMPORTANCE_REPEATS, by_metric)
        importances.append(means)
    by_fold = np.array(importances)
    importance = pl.DataFrame(
        {
            "feature": x.columns,
            "importance": by_fold.mean(axis=0),
            "spread": by_fold.std(axis=0, ddof=1),
        }
    ).sort("importance", descending=True)
    # Listed features, when preparation passes them through by name: other columns only feed
    # the preparation, so their importance says nothing about the model. A feature made by the
    # preparation hides which columns it came from, so then every column stays.
    if features is not None and set(features) <= set(x.columns):
        importance = importance.filter(pl.col("feature").is_in(features))
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
    if costs is not None:
        scores = scores.with_columns(
            positive=pl.lit(positive),
            positive_share=pl.lit(float((truth == costs["positive"]).mean())),
        )
    for name in recalls:
        scores = scores.with_columns(
            pl.Series(
                name,
                np.concatenate(
                    [shown[f"test_{name}"], rest[f"test_{name}"] if rest else np.array([])]
                ),
            )
        )
    if inner_folds is not None:

        def inner_splits(rows: np.ndarray, at: int) -> list[tuple[np.ndarray, np.ndarray]]:
            """Folds of `rows`, as indices into `rows`, kept apart as the outer folds are."""
            if time_column is not None:
                return _time_splits(train[rows], time_column, inner_folds, 1)
            if groups is not None:
                return _group_splits(task, truth[rows], groups[rows], inner_folds, 1, at)
            splitter = _splitter(task, y[rows], inner_folds, 1, at)
            return list(splitter.split(np.zeros(len(rows)), truth[rows]))

        score_inner = partial(_inner_score, model, x, truth, sign, score)
        every = np.arange(len(truth))
        scores = scores.with_columns(
            inner_folds=pl.lit(inner_folds),
            inner_score=pl.Series(
                [score_inner(fit, inner_splits(fit, seed + i)) for i, (fit, _) in enumerate(splits)]
            ),
            train_inner_score=pl.lit(score_inner(every, inner_splits(every, seed))),
        )
    return {
        "scores": scores,
        "predictions": predictions,
        "importance": importance,
        "figures": [_fit_figure(task, predictions), _importance_figure(importance)],
    }


def _recall_scorers(task: str, target: str, truth: np.ndarray, labels: list[str]) -> dict[str, Any]:
    """A scorer per named class, by its text, for the recall of that class."""
    if labels and task != "classification":
        raise ValueError(f"recall of a class needs a classification task, not {task}")
    classes = {str(c): c for c in np.unique(truth)}
    scorers = {}
    for i, label in enumerate(labels):
        if label not in classes:
            raise ValueError(f"{label!r} is not one of the {len(classes)} classes of {target}")
        scorers[f"recall_{i}"] = metrics.make_scorer(
            metrics.recall_score, labels=[classes[label]], average="macro", zero_division=np.nan
        )
    return scorers


def _inner_score(
    model: BaseEstimator,
    x: pl.DataFrame,
    truth: np.ndarray,
    sign: float,
    scoring: Any,
    rows: np.ndarray,
    folds: list[tuple[np.ndarray, np.ndarray]],
) -> float:
    """Mean score of `model` refit on inner folds of `rows`, in the scores' own units."""
    scored = model_selection.cross_val_score(
        model, x[rows], truth[rows], cv=folds, scoring=scoring, error_score="raise"
    )
    return float(sign * scored.mean())


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
    tuned: dict[str, list[str]] | None = None,
    settings: dict[str, dict[str, Any]] | None = None,
    guardrails: list[dict[str, Any]] | None = None,
    earlier_looks: list[str] | None = None,
) -> dict[str, Any]:
    """A SelectionDecision (ADR-0050). Of the candidates that beat the baseline on the same
    folds, the simplest whose mean is within one standard error of the best mean wins: the
    one-SE rule (Breiman et al. 1984; ESL §7.10). A `floor` baseline, a model that ignores its
    features, never wins; a `reference` baseline, the rule's recommended preparation, wins
    when no alternative beats it. `not_compared` is recorded as given. Beating the baseline
    means the corrected repeated k-fold t-test (Bouckaert & Frank 2004) rejects "no better
    than the baseline", one-sided at α = 0.05, after a Holm adjustment over the candidates.
    Both standard errors are corrected for folds that share train rows: the variance of a
    mean of n fold values is (1/n + n_validate/n_train) times their variance, not 1/n. That
    is the correction of Nadeau & Bengio (2003), applied to repeated k-fold as Bouckaert &
    Frank do.

    A study (ADR-0052) may `tune` a candidate over several trials: on each outer fold, the
    trial with the best inner score on that fold's training rows gives the candidate's score,
    so the outer validation rows never choose a setting and the tests above stay valid. Its
    settings to apply are the trial with the best inner score on all train rows. A candidate
    that misses a `guardrail` (a minimum mean recall of a class over the folds) cannot win,
    and does not set the one-SE bar. `earlier_looks` are recorded as given."""
    if both := sorted(set(trials) & {n["id"] for n in not_compared}):
        raise ValueError(f"{', '.join(both)} is both a trial and not compared")
    if baseline not in trials:
        raise ValueError(f"baseline {baseline} is not one of the trials {sorted(trials)}")
    protocol = trials[baseline].select(PROTOCOL)
    for name, trial in trials.items():
        if not trial.select(PROTOCOL).equals(protocol):
            raise ValueError(f"{name} was not scored on the same folds as {baseline}")
    sign = 1.0 if GREATER_IS_BETTER[metric] else -1.0
    declared = guardrails or []
    if declared and baseline_role == "reference":
        raise ValueError("guardrails apply to choosing a model, not to a reference baseline")
    scored, searches = _candidates(trials, tuned or {}, settings or {}, sign)
    if missing := sorted(set(scored) - set(complexity)):
        raise ValueError(f"no complexity for {missing}")
    trials = scored
    if protocol["metric"][0] != metric:
        raise ValueError(f"trials were scored by {protocol['metric'][0]}, not {metric}")
    k = protocol.height
    repeats = int(protocol["repeat"].max())  # type: ignore[arg-type]
    ratio = float((protocol["validate_rows"] / protocol["train_rows"]).mean())  # type: ignore[arg-type]
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
        if name in searches:
            result["search"] = searches[name]
        if declared:
            result["guardrails"] = [
                _guardrail(trials[name], i, g, k, ratio) for i, g in enumerate(declared)
            ]
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
    missing_guardrail = [
        c for c in beating if not all(g["passed"] for g in c.get("guardrails", []))
    ]
    beating = [c for c in beating if c not in missing_guardrail]
    reference = baseline_role == "reference"
    tested = [TESTED_REFERENCE, ONE_STEP] if reference else [TESTED]
    if searches:
        tested.append(TUNED.format(metric=LABEL[metric]))
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
    if metric == "expected_cost":
        share = float(trials[baseline]["positive_share"][0])
        decision["positive_share"] = share
        positive = trials[baseline]["positive"][0]
        decision["limitations"].append(AT_SHARE.format(share=share, positive=positive))
    if declared:
        decision["guardrails"] = declared
    if earlier_looks:
        decision["earlier_looks"] = earlier_looks
    missed = _missed(missing_guardrail, declared)
    if not beating and reference:
        decision["winner"] = baseline
        decision["reason"] = (
            f"No alternative beats the recommendation {baseline}: none passes the corrected "
            f"t-test against its {LABEL[metric]} at α = {ALPHA} after a Holm adjustment, over "
            f"the same {k} folds. {baseline} stands."
        )
        return decision
    if not beating and missed:
        decision["reason"] = f"No model that beats the baseline meets every guardrail: {missed}"
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
    # One phrase per verb form: "models that beat ... and meet", "a model that beats ... and meets".
    beat, beats = against, against
    if declared:
        beat += " and meet every guardrail"
        beats += " and meets every guardrail"
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
            f"{beat}. {then}{f' {missed}' if missed else ''}"
        )
        return decision
    versus = winner["versus_baseline"]
    decision["reason"] = (
        f"{winner['id']} has the best mean {LABEL[metric]} ({winner['mean']:.3f} ± "
        f"{winner['spread']:.3f}) of the {kind}s that beat {beat}, and no simpler {kind} "
        f"that beats {beats} is within one standard error of it. Over the same {k} folds it "
        f"improves on {baseline} by "
        f"{versus['mean_difference']:.3f} (corrected standard error {versus['corrected_se']:.3f}, "
        f"one-sided p = {versus['p_value']:.2g}).{f' {missed}' if missed else ''}"
    )
    return decision


def _candidates(
    trials: dict[str, pl.DataFrame],
    tuned: dict[str, list[str]],
    settings: dict[str, dict[str, Any]],
    sign: float,
) -> tuple[dict[str, pl.DataFrame], dict[str, dict[str, Any]]]:
    """Each candidate's scores, a tuned one's taken fold by fold from the trial its inner
    folds chose, and how each tuned one was searched."""
    grouped = [t for group in tuned.values() for t in group]
    if repeated := sorted({t for t in grouped if grouped.count(t) > 1}):
        raise ValueError(f"{', '.join(repeated)} is tuned for more than one candidate")
    if unknown := sorted(set(grouped) - set(trials)):
        raise ValueError(f"tuned trials {unknown} are not among the trials")
    if clash := sorted(set(tuned) & set(trials)):
        raise ValueError(f"{', '.join(clash)} is both a tuned candidate and a trial")
    if unset := sorted(set(grouped) - set(settings)):
        raise ValueError(f"no settings for tuned trials {unset}")
    scored = {name: frame for name, frame in trials.items() if name not in grouped}
    searches = {}
    for candidate, group in tuned.items():
        frames = [trials[t] for t in group]
        if any("inner_score" not in f.columns for f in frames):
            raise ValueError(f"{candidate}'s trials were not scored on inner folds")
        if len({f["inner_folds"][0] for f in frames}) > 1:
            raise ValueError(f"{candidate}'s trials were scored on different inner folds")
        inner = sign * np.column_stack([f["inner_score"].to_numpy() for f in frames])
        # argmax takes the first best, so ties go to the trial listed first.
        chosen = inner.argmax(axis=1)
        rows = np.arange(len(chosen))
        picked = {
            column: np.column_stack([f[column].to_numpy() for f in frames])[rows, chosen]
            for column in frames[0].columns
            if column == "score" or column.startswith("recall_")
        }
        scored[candidate] = (
            frames[0]
            .select(PROTOCOL)
            .with_columns(**{column: pl.Series(values) for column, values in picked.items()})
        )
        on_train = sign * np.array([f["train_inner_score"][0] for f in frames])
        searches[candidate] = {
            "trials": [
                {
                    "id": t,
                    "settings": settings[t],
                    "inner_mean": float(f["inner_score"].mean()),  # type: ignore[arg-type]
                    "chosen_in": int((chosen == i).sum()),
                }
                for i, (t, f) in enumerate(zip(group, frames, strict=True))
            ],
            "settings": settings[group[int(on_train.argmax())]],
        }
    return scored, searches


def _guardrail(
    scores: pl.DataFrame, index: int, guardrail: dict[str, Any], k: int, ratio: float
) -> dict[str, Any]:
    column = f"recall_{index}"
    if column not in scores.columns:
        raise ValueError(f"no recall of {guardrail['label']!r} was scored for a guardrail")
    recall = scores[column].to_numpy()
    # A fold without the class has no recall; scoring it 0 would fail the guardrail unseen.
    if missing := int(np.isnan(recall).sum()):
        raise ValueError(
            f"{missing} outer folds hold no row of class {guardrail['label']!r}, so its recall "
            "there is undefined"
        )
    mean = float(recall.mean())
    return {
        "label": guardrail["label"],
        "at_least": guardrail["at_least"],
        "mean": mean,
        "corrected_se": _corrected_se(recall, k, ratio),
        "passed": mean >= guardrail["at_least"],
    }


def _missed(candidates: list[dict[str, Any]], declared: list[dict[str, Any]]) -> str:
    """Why each candidate that beat the baseline was left out by a guardrail."""
    parts = []
    for c in candidates:
        for g, result in zip(declared, c["guardrails"], strict=True):
            if not result["passed"]:
                parts.append(
                    f"{c['id']} is left out: its mean recall of {g['label']} is "
                    f"{result['mean']:.3f}, below {g['at_least']}."
                )
    return " ".join(parts)


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
