"""Cross-validating shortlisted models on train rows, and choosing one only when it beats the
baseline on the same folds (ADR-0044)."""

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import pytest
from scipy import stats
from sklearn.base import BaseEstimator, ClassifierMixin, TransformerMixin

from sprisk_contracts import SelectionDecision
from sprisk_ml.compare import cross_validate, select_model
from sprisk_ml.models import (
    dummy_baseline_estimator,
    linear_model_estimator,
    random_forest_estimator,
)
from sprisk_workers.manifests import load_operators


def rows(n: int, seed: int, signal: bool = True) -> pl.DataFrame:
    """x drives y when `signal`; c is a category of noise; every seventh x is missing."""
    rng = np.random.default_rng(seed)
    x = rng.normal(size=n)
    y = x + rng.normal(scale=0.5, size=n) > 0 if signal else rng.random(n) > 0.5
    return pl.DataFrame(
        {
            "x": [None if k % 7 == 0 else float(v) for k, v in enumerate(x)],
            "c": ["abc"[k % 3] for k in range(n)],
            "y": np.where(y, "yes", "no"),
            "amount": x * 3.0 + rng.normal(scale=0.3, size=n),
        }
    )


CLASSIFY = {"target": "y", "features": ["x", "c"], "task": "classification"}
REGRESS = {"target": "amount", "features": ["x", "c"], "task": "regression"}


def scores(
    train: pl.DataFrame, build: Any, params: dict[str, Any], metric: str = "balanced_accuracy"
) -> pl.DataFrame:
    scored: pl.DataFrame = cross_validate(
        train, build, params, folds=5, seed=0, metric=metric, repeats=1, prepare=[]
    )["scores"]
    return scored


class FitRecorder(ClassifierMixin, BaseEstimator):  # type: ignore[misc]
    """Predicts the first class, and records how many rows each fit saw."""

    seen: list[int] = []

    def fit(self, x: Any, y: Any) -> "FitRecorder":
        FitRecorder.seen.append(len(x))
        self.classes_ = np.unique(y)
        return self

    def predict(self, x: Any) -> Any:
        return np.full(len(x), self.classes_[0])


def test_each_fold_scores_the_model_refit_on_the_other_rows() -> None:
    FitRecorder.seen = []
    train = rows(100, seed=1)

    result = scores(train, lambda schema, task: FitRecorder(), CLASSIFY)

    assert result["fold"].to_list() == [1, 2, 3, 4, 5]
    assert FitRecorder.seen == result["train_rows"].to_list()
    assert (result["train_rows"] + result["validate_rows"]).to_list() == [100] * 5


class RecordingStep(TransformerMixin, BaseEstimator):  # type: ignore[misc]
    """Records how many rows each fit saw, and passes rows through."""

    fits: list[int] = []

    def fit(self, x: Any, y: Any = None) -> "RecordingStep":
        RecordingStep.fits.append(len(x))
        return self

    def transform(self, x: Any) -> Any:
        return x


def test_preparation_between_the_split_and_the_model_is_refit_on_each_fold() -> None:
    RecordingStep.fits = []
    train = rows(100, seed=1)
    result = cross_validate(
        train, linear_model_estimator, CLASSIFY, 5, 0, "balanced_accuracy", 1, [RecordingStep()]
    )
    # One fit per fold on the fold's own rows, then permutation importance refits nothing.
    assert RecordingStep.fits == result["scores"]["train_rows"].to_list()
    assert result["importance"]["feature"].to_list() == ["x", "c"]


def test_importance_keeps_each_features_name_when_preparation_reads_all_columns() -> None:
    # The frame holds x before c; the features list c first.
    result = cross_validate(
        rows(200, seed=3),
        linear_model_estimator,
        {**CLASSIFY, "features": ["c", "x"]},
        5,
        0,
        "balanced_accuracy",
        1,
        [RecordingStep()],
    )
    importance = result["importance"]
    assert importance["feature"][0] == "x"
    assert importance["importance"][0] > 0.2 > abs(importance["importance"][1])


def test_folds_are_stratified_so_a_rare_class_is_in_every_fold() -> None:
    # Five rare rows in 100: only stratified folds give each fold exactly one.
    train = rows(100, seed=1).with_columns(
        y=pl.when(pl.int_range(pl.len()) < 5).then(pl.lit("rare")).otherwise(pl.lit("common"))
    )
    result = scores(train, dummy_baseline_estimator, CLASSIFY)
    # The dummy always says "common": half the classes right, on any fold holding both.
    assert result["score"].to_list() == [0.5] * 5


def test_every_candidate_gets_the_same_folds() -> None:
    train = rows(100, seed=1)
    dummy = scores(train, dummy_baseline_estimator, CLASSIFY)
    linear = scores(train, linear_model_estimator, CLASSIFY)
    forest = scores(train, random_forest_estimator, {**CLASSIFY, "n_estimators": 20})
    assert dummy["rows_digest"].to_list() == linear["rows_digest"].to_list()
    assert linear["rows_digest"].to_list() == forest["rows_digest"].to_list()
    assert dummy["rows_digest"].n_unique() == 5


def test_another_seed_gives_other_folds() -> None:
    train = rows(100, seed=1)
    first = scores(train, dummy_baseline_estimator, CLASSIFY)
    other = cross_validate(
        train, dummy_baseline_estimator, CLASSIFY, 5, 1, "balanced_accuracy", 1, []
    )
    assert first["rows_digest"].to_list() != other["scores"]["rows_digest"].to_list()


def test_every_train_row_is_predicted_once_by_a_model_that_did_not_see_it() -> None:
    train = rows(100, seed=1)
    result = cross_validate(
        train, linear_model_estimator, CLASSIFY, 5, 0, "balanced_accuracy", 1, []
    )
    predictions = result["predictions"]
    assert sorted(predictions["row"].to_list()) == list(range(100))
    assert predictions["actual"].to_list() == train["y"].gather(predictions["row"]).to_list()
    held = predictions.group_by("fold").len().sort("fold")["len"].to_list()
    assert held == result["scores"]["validate_rows"].to_list()


def test_the_feature_that_drives_the_target_matters_most_on_held_out_folds() -> None:
    result = cross_validate(
        rows(200, seed=3), linear_model_estimator, CLASSIFY, 5, 0, "balanced_accuracy", 1, []
    )
    importance = result["importance"]
    assert importance["feature"].to_list() == ["x", "c"]
    assert importance["importance"][0] > 0.2 > abs(importance["importance"][1])
    assert (importance["spread"] >= 0).all()


def test_the_diagnostics_are_drawn_from_the_train_rows_only() -> None:
    classified = cross_validate(
        rows(100, seed=1), linear_model_estimator, CLASSIFY, 5, 0, "balanced_accuracy", 1, []
    )
    regressed = cross_validate(
        rows(100, seed=1), linear_model_estimator, REGRESS, 5, 0, "rmse", 1, []
    )
    titles = [[f.layout.title.text for f in r["figures"]] for r in (classified, regressed)]
    assert titles == [
        [
            "Out-of-fold confusion matrix (train rows)",
            "Permutation importance on held-out folds (predictive, not causal)",
        ],
        [
            "Out-of-fold predicted against actual (train rows)",
            "Permutation importance on held-out folds (predictive, not causal)",
        ],
    ]


def timed(n: int) -> pl.DataFrame:
    """Rows shuffled out of time order, with a time column and a group of five rows each."""
    rng = np.random.default_rng(5)
    order = rng.permutation(n)
    return rows(n, seed=1).with_columns(
        t=pl.Series(order.tolist()), patient=pl.Series([f"p{k % (n // 5)}" for k in order])
    )


def test_time_ordered_folds_validate_only_on_rows_after_those_they_fit_on() -> None:
    train = timed(100)
    result = cross_validate(
        train, linear_model_estimator, CLASSIFY, 5, 0, "balanced_accuracy", 1, [], time_column="t"
    )
    scores, predictions = result["scores"], result["predictions"]
    assert scores["repeat"].to_list() == [1] * 5
    times = train["t"].to_list()
    for fold in range(1, 6):
        held = predictions.filter(pl.col("fold") == fold)["row"].to_list()
        fit_rows = scores.filter(pl.col("fold") == fold)["train_rows"][0]
        assert min(times[r] for r in held) >= fit_rows
    # The first block of time is only ever fit on, so it has no out-of-fold prediction.
    assert predictions.height < train.height


def test_group_folds_never_put_one_group_on_both_sides() -> None:
    train = timed(100)
    result = cross_validate(
        train,
        linear_model_estimator,
        CLASSIFY,
        5,
        0,
        "balanced_accuracy",
        2,
        [],
        group_column="patient",
    )
    groups = train["patient"].to_list()
    assert result["scores"]["repeat"].to_list() == [1] * 5 + [2] * 5
    predictions = result["predictions"]
    for fold in range(1, 6):
        held = set(predictions.filter(pl.col("fold") == fold)["row"].to_list())
        fit = set(range(100)) - held
        assert {groups[r] for r in held}.isdisjoint({groups[r] for r in fit})


def test_folds_follow_time_or_groups_not_both() -> None:
    with pytest.raises(ValueError, match="folds follow time or groups, not both"):
        cross_validate(
            timed(100),
            linear_model_estimator,
            CLASSIFY,
            5,
            0,
            "balanced_accuracy",
            1,
            [],
            time_column="t",
            group_column="patient",
        )


def test_time_ordered_folds_are_not_repeated() -> None:
    with pytest.raises(
        ValueError, match="time-ordered folds cannot be reshuffled; repeats must be 1"
    ):
        cross_validate(
            timed(100),
            linear_model_estimator,
            CLASSIFY,
            5,
            0,
            "balanced_accuracy",
            3,
            [],
            time_column="t",
        )


def test_regression_is_scored_by_rmse_where_lower_is_better() -> None:
    train = rows(100, seed=1)
    dummy = scores(train, dummy_baseline_estimator, REGRESS, metric="rmse")
    linear = scores(train, linear_model_estimator, REGRESS, metric="rmse")
    assert (linear["score"] > 0).all()
    assert linear["score"].sum() < dummy["score"].sum()


@pytest.mark.parametrize(
    ("train", "params", "metric", "message"),
    [
        (
            rows(100, seed=1),
            CLASSIFY,
            "rmse",
            "metric rmse does not fit a classification task; it is balanced_accuracy",
        ),
        (rows(100, seed=1), {**CLASSIFY, "features": ["x", "y"]}, "balanced_accuracy", "'y'"),
        (
            rows(100, seed=1),
            {**CLASSIFY, "task": "ranking"},
            "balanced_accuracy",
            "a ranking task has no comparison metric",
        ),
        (
            rows(100, seed=1).with_columns(pl.lit(None, pl.String).alias("y")),
            CLASSIFY,
            "balanced_accuracy",
            "y has 100 missing values in train",
        ),
        (
            pl.concat([rows(100, seed=1), rows(3, seed=2).with_columns(y=pl.lit("rare"))]),
            CLASSIFY,
            "balanced_accuracy",
            "class 'rare' has 3 train rows; 5 folds need at least 5 of each class",
        ),
    ],
)
def test_a_comparison_that_cannot_be_fair_is_refused(
    train: pl.DataFrame, params: dict[str, Any], metric: str, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        scores(train, linear_model_estimator, params, metric=metric)


class FailsOnThirdFit(FitRecorder):
    def fit(self, x: Any, y: Any) -> "FailsOnThirdFit":
        if len(FitRecorder.seen) == 2:
            raise ValueError("fit failed on fold 3")
        super().fit(x, y)
        return self


def test_one_fold_that_fails_fails_the_step_instead_of_scoring_it_nan() -> None:
    FitRecorder.seen = []
    with pytest.raises(ValueError, match="fit failed on fold 3"):
        scores(rows(100, seed=1), lambda schema, task: FailsOnThirdFit(), CLASSIFY)


def trial(fold_scores: list[float], metric: str = "balanced_accuracy") -> pl.DataFrame:
    k = len(fold_scores)
    return pl.DataFrame(
        {
            "metric": [metric] * k,
            "folds": [k] * k,
            "seed": [0] * k,
            "repeat": [1] * k,
            "fold": list(range(1, k + 1)),
            "score": fold_scores,
            "train_rows": [80] * k,
            "validate_rows": [20] * k,
            "rows_digest": [f"sha256:{f}" for f in range(k)],
            "folds_by": ["shuffle"] * k,
        }
    )


BASE = "ml_dummy_baseline"


COMPLEXITY = {BASE: 0, "ml_linear_model": 1, "ml_random_forest": 2, "ml_lm": 1}


def select(trials: dict[str, pl.DataFrame], **settings: Any) -> SelectionDecision:
    chosen = select_model(
        trials,
        baseline=settings.get("baseline", BASE),
        metric=settings.get("metric", "balanced_accuracy"),
        complexity=settings.get("complexity", COMPLEXITY),
        baseline_role=settings.get("baseline_role", "floor"),
        not_compared=settings.get("not_compared", []),
    )
    # Through JSON, as the worker writes it.
    return SelectionDecision.model_validate_json(json.dumps(chosen))


def test_the_best_model_that_beats_the_baseline_wins() -> None:
    decision = select(
        {
            BASE: trial([0.5, 0.5, 0.5, 0.5, 0.5]),
            "ml_linear_model": trial([0.8, 0.82, 0.79, 0.81, 0.8]),
            "ml_random_forest": trial([0.84, 0.85, 0.83, 0.86, 0.84]),
        }
    )
    assert decision.winner == "ml_random_forest"
    assert decision.reason.startswith(
        "ml_random_forest has the best mean balanced accuracy (0.844 ± 0.011) of the models "
        "that beat the baseline, and no simpler model that beats the baseline is within one "
        "standard error of it"
    )
    by_id = {c.id: c for c in decision.candidates}
    assert by_id[BASE].versus_baseline is None
    assert by_id[BASE].mean == 0.5
    assert by_id["ml_linear_model"].versus_baseline is not None
    assert by_id["ml_linear_model"].versus_baseline.beats_baseline


def test_a_simpler_model_within_one_standard_error_of_the_best_is_recommended() -> None:
    # Iris: linear and forest score the same, so the forest adds nothing measurable.
    same = [1.0, 0.958, 0.958, 0.958, 0.958]
    decision = select(
        {BASE: trial([0.333] * 5), "ml_linear_model": trial(same), "ml_random_forest": trial(same)}
    )
    assert decision.winner == "ml_linear_model"
    assert decision.reason == (
        "ml_linear_model and ml_random_forest are within one standard error (0.013) of the best "
        "mean balanced accuracy (0.966) and beat the baseline. ml_linear_model is the simplest of "
        "them; the extra gain of the more flexible ones is within one standard error, so it is "
        "not counted."
    )


def test_equally_simple_models_near_the_best_go_to_the_better_mean() -> None:
    decision = select(
        {
            BASE: trial([0.5] * 5),
            "ml_linear_model": trial([0.9, 0.85, 0.95, 0.88, 0.92]),
            "ml_lm": trial([0.89, 0.84, 0.94, 0.87, 0.91]),
        }
    )
    assert decision.winner == "ml_linear_model"
    assert decision.reason.endswith(
        "They are equally simple, so ml_linear_model, with the best mean, is recommended."
    )


def test_a_model_clearly_better_than_a_simpler_one_is_recommended() -> None:
    decision = select(
        {
            BASE: trial([0.5] * 5),
            "ml_linear_model": trial([0.70, 0.72, 0.69, 0.71, 0.70]),
            "ml_random_forest": trial([0.90, 0.91, 0.89, 0.92, 0.90]),
        }
    )
    assert decision.winner == "ml_random_forest"


def test_every_trial_needs_a_complexity() -> None:
    with pytest.raises(ValueError, match=r"no complexity for \['ml_linear_model'\]"):
        select(
            {BASE: trial([0.5] * 5), "ml_linear_model": trial([0.8] * 5)},
            complexity={BASE: 0},
        )


def test_folds_are_repeated_with_new_shuffles_and_each_row_is_predicted_once() -> None:
    train = rows(100, seed=1)
    result = cross_validate(
        train, linear_model_estimator, CLASSIFY, 5, 0, "balanced_accuracy", 3, []
    )
    scores = result["scores"]
    assert scores["repeat"].to_list() == [1] * 5 + [2] * 5 + [3] * 5
    assert scores["fold"].to_list() == [1, 2, 3, 4, 5] * 3
    assert scores["rows_digest"].n_unique() == 15
    assert sorted(result["predictions"]["row"].to_list()) == list(range(100))


def test_beating_the_baseline_is_a_corrected_repeated_k_fold_t_test() -> None:
    linear = [0.6, 0.55, 0.7, 0.52, 0.65]
    decision = select({BASE: trial([0.5] * 5), "ml_linear_model": trial(linear)})
    [compared] = [c.versus_baseline for c in decision.candidates if c.versus_baseline]
    gain = np.array(linear) - 0.5
    t = gain.mean() / math.sqrt((1 / 5 + 20 / 80) * gain.var(ddof=1))
    assert compared.p_value == pytest.approx(stats.t.sf(t, df=4))
    assert compared.beats_baseline == (stats.t.sf(t, df=4) <= 0.05)


def test_two_marginal_models_do_not_both_pass_once_adjusted_for_comparing_two() -> None:
    # Each alone would pass at 0.05; Holm compares the smaller p with 0.025.
    marginal = [0.6, 0.53, 0.67, 0.565, 0.635]
    decision = select(
        {
            BASE: trial([0.5] * 5),
            "ml_linear_model": trial(marginal),
            "ml_random_forest": trial(marginal),
        }
    )
    ps = [c.versus_baseline.p_value for c in decision.candidates if c.versus_baseline]
    assert all(p is not None and 0.025 < p <= 0.05 for p in ps), ps
    assert decision.winner is None


def test_the_standard_error_is_corrected_for_folds_that_share_train_rows() -> None:
    linear = [0.6, 0.55, 0.7, 0.52, 0.65]
    decision = select({BASE: trial([0.5] * 5), "ml_linear_model": trial(linear)})
    [compared] = [c.versus_baseline for c in decision.candidates if c.versus_baseline]
    differences = np.array(linear) - 0.5
    # Nadeau & Bengio (2003): (1/k + n_validate/n_train) in place of 1/k.
    expected = math.sqrt((1 / 5 + 20 / 80) * differences.var(ddof=1))
    assert compared.mean_difference == pytest.approx(differences.mean())
    assert compared.corrected_se == pytest.approx(expected)
    assert compared.corrected_se > math.sqrt(differences.var(ddof=1) / 5)


def test_a_model_within_the_noise_of_the_baseline_does_not_win() -> None:
    decision = select(
        {BASE: trial([0.5] * 5), "ml_linear_model": trial([0.6, 0.42, 0.58, 0.45, 0.55])}
    )
    assert decision.winner is None
    assert decision.reason.startswith("No model beats the baseline")


def test_for_rmse_lower_is_better() -> None:
    decision = select(
        {
            BASE: trial([3.0, 3.1, 2.9, 3.0, 3.0], "rmse"),
            "ml_linear_model": trial([1.0, 1.1, 0.9, 1.0, 1.05], "rmse"),
        },
        metric="rmse",
    )
    assert decision.winner == "ml_linear_model"
    [compared] = [c.versus_baseline for c in decision.candidates if c.versus_baseline]
    assert compared.mean_difference == pytest.approx(1.99)


SCREENING = (
    "Beating the baseline means a corrected repeated k-fold t-test (Bouckaert & Frank 2004) "
    "rejects 'no better than the baseline' at α = 0.05 after a Holm adjustment over the "
    "candidates. Folds share rows, so the test is approximate."
)


def test_every_decision_says_how_beating_the_baseline_was_tested() -> None:
    decision = select({BASE: trial([0.5] * 5), "ml_linear_model": trial([0.8] * 5)})
    assert [limit.root for limit in decision.limitations] == [SCREENING]


@pytest.mark.parametrize(
    ("trials", "settings", "message"),
    [
        (
            {"ml_linear_model": trial([0.8] * 5)},
            {},
            r"baseline ml_dummy_baseline is not one of the trials \['ml_linear_model'\]",
        ),
        (
            {BASE: trial([0.5] * 5), "ml_linear_model": trial([0.8] * 5)},
            {"metric": "rmse"},
            "trials were scored by balanced_accuracy, not rmse",
        ),
        (
            {
                BASE: trial([0.5] * 5),
                "ml_linear_model": trial([0.8] * 5).with_columns(
                    pl.lit("sha256:x").alias("rows_digest")
                ),
            },
            {},
            "ml_linear_model was not scored on the same folds as ml_dummy_baseline",
        ),
        (
            {BASE: trial([0.5] * 5), "ml_linear_model": trial([0.8] * 4)},
            {},
            "ml_linear_model was not scored on the same folds as ml_dummy_baseline",
        ),
    ],
)
def test_trials_that_cannot_be_compared_are_refused(
    trials: dict[str, pl.DataFrame], settings: dict[str, Any], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        select(trials, **settings)


def test_a_model_no_better_than_the_dummy_on_the_same_folds_does_not_win() -> None:
    train = rows(200, seed=3, signal=False)
    decision = select(
        {
            BASE: scores(train, dummy_baseline_estimator, CLASSIFY),
            "ml_linear_model": scores(train, linear_model_estimator, CLASSIFY),
        }
    )
    assert decision.winner is None


def test_a_model_that_learns_the_signal_beats_the_dummy() -> None:
    train = rows(200, seed=3)
    decision = select(
        {
            BASE: scores(train, dummy_baseline_estimator, CLASSIFY),
            "ml_linear_model": scores(train, linear_model_estimator, CLASSIFY),
        }
    )
    assert decision.winner == "ml_linear_model"


def test_the_worker_runs_a_comparison_from_the_manifests(tmp_path: Path) -> None:
    operators = load_operators(Path(__file__).parents[2])
    train = tmp_path / "train.parquet"
    rows(200, seed=3).write_parquet(train)
    cross_validated = {}
    for name, ref in [
        (BASE, "sprisk.ml.dummy_baseline@1.0.0"),
        ("ml_lm", "sprisk.ml.linear_model@1.0.0"),
    ]:
        out = tmp_path / name
        out.mkdir()
        params = {
            "candidate": ref,
            "candidate_params": CLASSIFY,
            "folds": 5,
            "seed": 0,
            "repeats": 2,
            # Run in each fold by the worker, from the scale step's own code.
            "prepare": [
                {
                    "operator": "sprisk.clean.scale@1.0.0",
                    "params": {"columns": ["x"], "method": "z_score"},
                }
            ],
        }
        written = operators["sprisk.ml.cross_validate@2.0.0"].run(
            params | {"metric": "balanced_accuracy"}, {"train": train}, out
        )
        by_port = {o.port: o.path for o in written}
        assert set(by_port) == {"scores", "predictions", "importance", "figures"}
        cross_validated[name] = by_port["scores"]
    out = tmp_path / "select"
    out.mkdir()
    params = {"trials": [BASE, "ml_lm"], "baseline": BASE, "metric": "balanced_accuracy"}
    params |= {"complexity": {BASE: 0, "ml_lm": 1}, "baseline_role": "floor", "not_compared": []}
    [decision] = operators["sprisk.ml.select_model@3.0.0"].run(params, cross_validated, out)
    assert SelectionDecision.model_validate_json(decision.path.read_text()).winner == "ml_lm"


def test_a_time_ordered_comparison_says_its_test_is_a_rough_guide() -> None:
    def timed_trial(scores: list[float]) -> pl.DataFrame:
        return trial(scores).with_columns(folds_by=pl.lit("time"))

    decision = select({BASE: timed_trial([0.5] * 5), "ml_linear_model": timed_trial([0.8] * 5)})
    assert [limit.root for limit in decision.limitations][1].startswith("Folds follow time")


REFERENCE = "standard_scaling"
PREPARATION = {REFERENCE: 1, "robust_scaling": 1, "no_scaling": 0}


def prepared(trials: dict[str, pl.DataFrame], **settings: Any) -> SelectionDecision:
    """A preparation comparison: the rule's recommendation is the reference (ADR-0047)."""
    return select(
        trials, baseline=REFERENCE, baseline_role="reference", complexity=PREPARATION, **settings
    )


def test_a_floor_baseline_is_recorded_as_one() -> None:
    decision = select({BASE: trial([0.5] * 5), "ml_linear_model": trial([0.8] * 5)})
    assert decision.baseline_role == "floor"


def test_the_recommendation_stands_when_no_alternative_beats_it() -> None:
    decision = prepared(
        {REFERENCE: trial([0.8] * 5), "robust_scaling": trial([0.82, 0.78, 0.83, 0.79, 0.8])}
    )
    assert decision.baseline_role == "reference"
    assert decision.winner == REFERENCE
    assert decision.reason == (
        "No alternative beats the recommendation standard_scaling: none passes the corrected "
        "t-test against its balanced accuracy at α = 0.05 after a Holm adjustment, over the "
        "same 5 folds. standard_scaling stands."
    )


def test_an_alternative_that_beats_the_recommendation_replaces_it() -> None:
    decision = prepared(
        {REFERENCE: trial([0.7] * 5), "robust_scaling": trial([0.85, 0.86, 0.84, 0.85, 0.86])}
    )
    assert decision.winner == "robust_scaling"
    assert decision.reason.startswith(
        "robust_scaling has the best mean balanced accuracy (0.852 ± 0.008) of the alternatives "
        "that beat the recommendation, and no simpler alternative that beats the recommendation "
        "is within one standard error of it. Over the same 5 folds it improves on "
        "standard_scaling by 0.152"
    )


def test_removing_the_step_wins_when_it_is_as_good_as_the_best_that_beats_the_recommendation() -> (
    None
):
    better = [0.85, 0.86, 0.84, 0.85, 0.86]
    decision = prepared(
        {REFERENCE: trial([0.7] * 5), "robust_scaling": trial(better), "no_scaling": trial(better)}
    )
    assert decision.winner == "no_scaling"
    assert decision.reason.endswith(
        "no_scaling is the simplest of them; the extra gain of the others is within one standard "
        "error, so it is not counted."
    )


def test_a_reference_comparison_says_how_beating_the_recommendation_was_tested() -> None:
    decision = prepared({REFERENCE: trial([0.8] * 5), "no_scaling": trial([0.8] * 5)})
    assert [limit.root for limit in decision.limitations] == [
        "Beating the recommendation means a corrected repeated k-fold t-test (Bouckaert & "
        "Frank 2004) rejects 'no better than the recommendation' at α = 0.05 after a Holm "
        "adjustment over the alternatives. Folds share rows, so the test is approximate.",
        "Only this step changed: the model and the other steps were as the flow has them, so "
        "the choice holds for this model, not for every model.",
    ]


def test_what_was_not_compared_is_recorded_with_why() -> None:
    skipped = [{"id": "maxabs_scaling_sparse", "reason": "The scale step has no max-abs method."}]
    decision = prepared(
        {REFERENCE: trial([0.8] * 5), "no_scaling": trial([0.8] * 5)}, not_compared=skipped
    )
    assert decision.not_compared is not None
    assert [(n.id, n.reason) for n in decision.not_compared] == [
        ("maxabs_scaling_sparse", "The scale step has no max-abs method.")
    ]


def test_an_alternative_both_compared_and_not_is_refused() -> None:
    with pytest.raises(ValueError, match=r"no_scaling is both a trial and not compared"):
        prepared(
            {REFERENCE: trial([0.8] * 5), "no_scaling": trial([0.8] * 5)},
            not_compared=[{"id": "no_scaling", "reason": "r"}],
        )
