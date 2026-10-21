"""Tuning inside the outer folds (nested cross-validation) and guardrails on the choice
(ADR-0051)."""

import json
from typing import Any

import numpy as np
import polars as pl
import pytest
from sklearn.base import BaseEstimator, ClassifierMixin

from sprisk_contracts import SelectionDecision
from sprisk_ml.compare import cross_validate, select_model
from sprisk_ml.models import dummy_baseline_estimator, linear_model_estimator

CLASSIFY = {"target": "y", "features": ["row"], "task": "classification"}


def labelled(n: int) -> pl.DataFrame:
    """`row` is the row's index; y is "yes" on one row in three."""
    return pl.DataFrame(
        {"row": list(range(n)), "y": ["yes" if k % 3 == 0 else "no" for k in range(n)]}
    )


class RowRecorder(ClassifierMixin, BaseEstimator):  # type: ignore[misc]
    """Records which rows each fit saw, by their `row` value, and predicts the first class."""

    fits: list[set[int]] = []

    def fit(self, x: Any, y: Any) -> "RowRecorder":
        RowRecorder.fits.append({int(v) for v in np.asarray(x)[:, 0]})
        self.classes_ = np.unique(y)
        return self

    def predict(self, x: Any) -> Any:
        return np.full(len(x), self.classes_[0])


def nested(train: pl.DataFrame, build: Any, **extra: Any) -> dict[str, Any]:
    return cross_validate(
        train, build, CLASSIFY, 5, 0, "balanced_accuracy", 1, [], inner_folds=3, **extra
    )


def test_inner_folds_fit_only_on_their_outer_fold_s_training_rows() -> None:
    RowRecorder.fits = []
    result = nested(labelled(60), lambda schema, task: RowRecorder())
    held = result["predictions"].group_by("fold").agg(pl.col("row")).sort("fold")["row"].to_list()
    all_rows = set(range(60))
    # Five outer fits, then three inner fits per outer fold, then three on all train rows.
    assert len(RowRecorder.fits) == 5 + 5 * 3 + 3
    for fold, validation in enumerate(held):
        for inner in RowRecorder.fits[5 + 3 * fold : 8 + 3 * fold]:
            assert inner < all_rows - set(validation), f"outer fold {fold + 1}"
    assert set().union(*RowRecorder.fits[-3:]) == all_rows


def test_a_tuned_trial_writes_its_inner_scores_beside_its_outer_ones() -> None:
    scores = nested(labelled(60), dummy_baseline_estimator)["scores"]
    # The dummy says "no": half the classes right, inner and outer alike.
    assert scores["inner_score"].to_list() == [0.5] * 5
    assert scores["train_inner_score"].to_list() == [0.5] * 5
    untuned = cross_validate(
        labelled(60), dummy_baseline_estimator, CLASSIFY, 5, 0, "balanced_accuracy", 1, []
    )["scores"]
    assert "inner_score" not in untuned.columns


def test_recall_of_a_class_is_written_for_every_outer_fold() -> None:
    scores = cross_validate(
        labelled(60),
        dummy_baseline_estimator,
        CLASSIFY,
        5,
        0,
        "balanced_accuracy",
        2,
        [],
        recall_of=["yes", "no"],
    )["scores"]
    # The dummy never says "yes" and always says "no".
    assert scores["recall_0"].to_list() == [0.0] * 10
    assert scores["recall_1"].to_list() == [1.0] * 10


def test_recall_of_a_value_the_target_never_takes_is_refused() -> None:
    with pytest.raises(
        ValueError, match=r"'maybe' is not a class of y; its classes are \['no', 'yes'\]"
    ):
        cross_validate(
            labelled(60),
            linear_model_estimator,
            CLASSIFY,
            5,
            0,
            "balanced_accuracy",
            1,
            [],
            recall_of=["maybe"],
        )


def frame(
    scores: list[float],
    inner: list[float] | None = None,
    train_inner: float | None = None,
    recall: list[float] | None = None,
) -> pl.DataFrame:
    k = len(scores)
    columns: dict[str, Any] = {
        "metric": ["balanced_accuracy"] * k,
        "folds": [k] * k,
        "seed": [0] * k,
        "repeat": [1] * k,
        "fold": list(range(1, k + 1)),
        "score": scores,
        "train_rows": [80] * k,
        "validate_rows": [20] * k,
        "rows_digest": [f"sha256:{f}" for f in range(k)],
        "folds_by": ["shuffle"] * k,
    }
    if inner is not None:
        columns["inner_score"] = inner
        columns["train_inner_score"] = [train_inner] * k
    if recall is not None:
        columns["recall_0"] = recall
    return pl.DataFrame(columns)


BASE = "ml_dummy_baseline"
FOREST = "ml_random_forest"
COMPLEXITY = {BASE: 0, "ml_linear_model": 1, FOREST: 2}


def select(trials: dict[str, pl.DataFrame], **extra: Any) -> SelectionDecision:
    chosen = select_model(
        trials,
        baseline=BASE,
        metric="balanced_accuracy",
        complexity=COMPLEXITY,
        baseline_role="floor",
        not_compared=[],
        **extra,
    )
    return SelectionDecision.model_validate_json(json.dumps(chosen))


TUNED = {FOREST: [f"{FOREST}_t1", f"{FOREST}_t2"]}
SETTINGS = {f"{FOREST}_t1": {"min_samples_leaf": 1}, f"{FOREST}_t2": {"min_samples_leaf": 5}}


def test_each_outer_fold_takes_the_trial_its_inner_folds_chose_never_the_best_outer_score() -> None:
    decision = select(
        {
            BASE: frame([0.5] * 5),
            # t1 scores best on every outer fold, but its inner folds rank it below t2.
            f"{FOREST}_t1": frame([0.95] * 5, inner=[0.70] * 5, train_inner=0.70),
            f"{FOREST}_t2": frame(
                [0.80, 0.82, 0.79, 0.81, 0.80], inner=[0.75] * 5, train_inner=0.76
            ),
        },
        tuned=TUNED,
        settings=SETTINGS,
    )
    forest = next(c for c in decision.candidates if c.id == FOREST)
    assert forest.fold_scores == [0.80, 0.82, 0.79, 0.81, 0.80]
    assert forest.search is not None
    assert [(t.id, t.chosen_in, t.inner_mean) for t in forest.search.trials] == [
        (f"{FOREST}_t1", 0, 0.70),
        (f"{FOREST}_t2", 5, 0.75),
    ]
    assert forest.search.settings.model_dump() == {"min_samples_leaf": 5}
    assert {c.id for c in decision.candidates} == {BASE, FOREST}
    assert decision.winner == FOREST
    assert any("describes the tuning" in limit.root for limit in decision.limitations)


def test_folds_may_choose_different_trials_and_ties_go_to_the_first() -> None:
    decision = select(
        {
            BASE: frame([0.5] * 4),
            f"{FOREST}_t1": frame(
                [0.9, 0.9, 0.7, 0.7], inner=[0.8, 0.8, 0.6, 0.7], train_inner=0.7
            ),
            f"{FOREST}_t2": frame(
                [0.6, 0.6, 0.8, 0.8], inner=[0.7, 0.8, 0.7, 0.6], train_inner=0.7
            ),
        },
        tuned=TUNED,
        settings=SETTINGS,
    )
    forest = next(c for c in decision.candidates if c.id == FOREST)
    # Fold 2 ties at 0.8 and goes to t1; fold 3 goes to t2; equal train scores go to t1.
    assert forest.fold_scores == [0.9, 0.9, 0.8, 0.7]
    assert forest.search is not None
    assert [t.chosen_in for t in forest.search.trials] == [3, 1]
    assert forest.search.settings.model_dump() == {"min_samples_leaf": 1}


def test_a_candidate_below_a_guardrail_cannot_win_and_does_not_set_the_bar() -> None:
    guardrails = [{"metric": "recall", "label": "bad", "at_least": 0.6}]
    decision = select(
        {
            BASE: frame([0.5] * 5, recall=[0.0] * 5),
            "ml_linear_model": frame([0.70, 0.71, 0.69, 0.70, 0.70], recall=[0.65] * 5),
            # The forest scores best but misses half the bad rows.
            "ml_random_forest": frame([0.80, 0.81, 0.79, 0.80, 0.80], recall=[0.50] * 5),
        },
        guardrails=guardrails,
    )
    assert decision.winner == "ml_linear_model"
    assert decision.guardrails is not None and decision.guardrails[0].label == "bad"
    by_id = {c.id: c for c in decision.candidates}
    forest = by_id["ml_random_forest"].guardrails
    assert forest is not None and (forest[0].mean, forest[0].passed) == (0.5, False)
    linear = by_id["ml_linear_model"].guardrails
    assert linear is not None and linear[0].passed
    assert "ml_random_forest" in decision.reason and "recall of bad" in decision.reason


def test_no_winner_when_every_model_that_beats_the_baseline_misses_a_guardrail() -> None:
    decision = select(
        {
            BASE: frame([0.5] * 5, recall=[0.0] * 5),
            "ml_linear_model": frame([0.70, 0.71, 0.69, 0.70, 0.70], recall=[0.3] * 5),
        },
        guardrails=[{"metric": "recall", "label": "bad", "at_least": 0.6}],
    )
    assert decision.winner is None
    assert decision.reason.startswith("No model that beats the baseline meets every guardrail")


def test_earlier_looks_at_the_same_folds_are_recorded() -> None:
    earlier = ["plv_01JABCDEFGHJKMNPQRSTVWXYZ3"]
    decision = select(
        {BASE: frame([0.5] * 5), "ml_linear_model": frame([0.8] * 5)}, earlier_looks=earlier
    )
    assert decision.earlier_looks is not None
    assert [
        str(v.root) if hasattr(v, "root") else str(v) for v in decision.earlier_looks
    ] == earlier
