from typing import Any

import numpy as np
import polars as pl
import pytest
import skops.io
from sklearn.model_selection import RepeatedStratifiedKFold

from sprisk_ml.costs import expected_cost
from sprisk_ml.evaluate import evaluate
from sprisk_ml.models import dummy_baseline, linear_model, random_forest
from sprisk_workers.plain import TRUSTED_MODEL_TYPES

COSTS = {"positive": "bad", "false_negative": 5.0, "false_positive": 1.0}


def risky(n: int = 400, seed: int = 0) -> pl.DataFrame:
    """Rows whose chance of `bad` rises with x; 30% of them are bad."""
    rng = np.random.default_rng(seed)
    x = rng.normal(size=n)
    bad = rng.random(n) < 1 / (1 + np.exp(-(1.5 * x - 1.2)))
    return pl.DataFrame({"x": x, "y": np.where(bad, "bad", "good")})


def params(**more: Any) -> dict[str, Any]:
    return {"target": "y", "features": ["x"], "task": "classification", **more}


def test_expected_cost_is_the_mean_cost_of_the_mistakes() -> None:
    truth = np.array(["bad", "good", "bad", "good"])
    predicted = np.array(["good", "good", "bad", "bad"])
    # One missed bad (5) and one false alarm (1) over four rows.
    assert expected_cost(truth, predicted, "bad", 5.0, 1.0) == pytest.approx(1.5)


def test_a_model_with_costs_refuses_more_and_costs_less_than_at_one_half() -> None:
    train, test = risky(seed=0), risky(seed=1)
    plain = linear_model(train, **params())
    costed = linear_model(train, **params(costs=COSTS))
    truth = test["y"].to_numpy()
    cost = {
        name: expected_cost(truth, model.predict(test.select("x")), "bad", 5.0, 1.0)
        for name, model in {"plain": plain, "costed": costed}.items()
    }
    assert cost["costed"] < cost["plain"]
    assert costed.threshold < 0.5


def test_the_costed_baseline_is_the_cheaper_constant_decision() -> None:
    train = risky()
    refuse = dummy_baseline(train, **params(costs=COSTS))
    # 30% bad: refusing everyone costs 0.7 a row, approving everyone 1.5.
    assert set(refuse.predict(train.select("x"))) == {"bad"}
    cheap_misses = {**COSTS, "false_negative": 1.0, "false_positive": 5.0}
    approve = dummy_baseline(train, **params(costs=cheap_misses))
    assert set(approve.predict(train.select("x"))) == {"good"}


def test_a_costed_model_saves_and_loads_with_only_trusted_types() -> None:
    model = random_forest(risky(), **params(costs=COSTS), n_estimators=10)
    loaded = skops.io.loads(skops.io.dumps(model), trusted=TRUSTED_MODEL_TYPES)
    rows = risky(seed=2).select("x")
    assert (loaded.predict(rows) == model.predict(rows)).all()


def test_evaluate_reports_the_cut_off_and_expected_cost_of_a_costed_model() -> None:
    model = linear_model(risky(), **params(costs=COSTS))
    # As the step's model file: the costs travel with the model.
    model = skops.io.loads(skops.io.dumps(model), trusted=TRUSTED_MODEL_TYPES)
    test = risky(seed=1)
    metrics = evaluate(model, test, target="y", task="classification")["metrics"]
    assert metrics["cut_off"] == {"positive": "bad", "at": pytest.approx(model.threshold)}
    expected = expected_cost(test["y"].to_numpy(), model.predict(test.select("x")), "bad", 5.0, 1.0)
    assert metrics["expected_cost"] == pytest.approx(expected)
    assert metrics["estimator"] == "LogisticRegression"


def test_costs_need_two_classes_and_name_one_of_them() -> None:
    with pytest.raises(ValueError, match="'risky' is not one of the 2 classes of y"):
        linear_model(risky(), **params(costs={**COSTS, "positive": "risky"}))
    three = risky().with_columns(
        pl.when(pl.col("x") > 1).then(pl.lit("odd")).otherwise("y").alias("y")
    )
    with pytest.raises(ValueError, match="costs need two classes; y has 3"):
        linear_model(three, **params(costs=COSTS))


def cv(train: pl.DataFrame, build: Any, candidate_params: dict[str, Any], **more: Any) -> Any:
    from sprisk_ml.compare import cross_validate

    settings = {"folds": 5, "seed": 0, "metric": "expected_cost", "repeats": 1, "prepare": []}
    return cross_validate(train, build, candidate_params, **{**settings, **more})["scores"]


def test_with_costs_each_fold_scores_expected_cost_and_the_floor_refuses_everyone() -> None:
    from sprisk_ml.models import dummy_baseline_estimator, linear_model_estimator

    train = risky()
    floor = cv(train, dummy_baseline_estimator, params(costs=COSTS))
    linear = cv(train, linear_model_estimator, params(costs=COSTS))
    assert floor["metric"].to_list() == ["expected_cost"] * 5
    # Refusing everyone costs 1 for each good row of the fold's validation rows.
    truth = train["y"].to_numpy()
    splitter = RepeatedStratifiedKFold(n_splits=5, n_repeats=1, random_state=0)
    folds = list(splitter.split(np.zeros(len(truth)), truth))
    good_share = [float((truth[held] == "good").mean()) for _, held in folds]
    assert floor["score"].to_list() == pytest.approx(good_share)
    assert linear["score"].mean() < floor["score"].mean()
    assert floor["positive"].to_list() == ["bad"] * 5
    assert floor["positive_share"].to_list() == pytest.approx([float((truth == "bad").mean())] * 5)


def test_costs_and_expected_cost_go_together() -> None:
    from sprisk_ml.models import linear_model_estimator

    with pytest.raises(
        ValueError, match="costs are scored by expected_cost, not balanced_accuracy"
    ):
        cv(risky(), linear_model_estimator, params(costs=COSTS), metric="balanced_accuracy")
    with pytest.raises(ValueError, match="expected_cost needs the model step's costs"):
        cv(risky(), linear_model_estimator, params())


def test_costs_after_a_time_or_group_split_are_refused() -> None:
    from sprisk_ml.models import linear_model_estimator

    grouped = risky().with_columns(g=pl.int_range(pl.len()) % 40)
    with pytest.raises(ValueError, match="costs need folds that are shuffled rows"):
        cv(grouped, linear_model_estimator, params(costs=COSTS), group_column="g")


def test_a_cost_comparison_lower_is_better_and_records_the_class_share() -> None:
    import json

    from sprisk_contracts import SelectionDecision
    from sprisk_ml.compare import select_model

    def trial(fold_scores: list[float]) -> pl.DataFrame:
        k = len(fold_scores)
        return pl.DataFrame(
            {
                "metric": ["expected_cost"] * k,
                "folds": [k] * k,
                "seed": [0] * k,
                "repeat": [1] * k,
                "fold": list(range(1, k + 1)),
                "score": fold_scores,
                "train_rows": [80] * k,
                "validate_rows": [20] * k,
                "rows_digest": [f"sha256:{f}" for f in range(k)],
                "folds_by": ["shuffle"] * k,
                "positive": ["bad"] * k,
                "positive_share": [0.3] * k,
            }
        )

    chosen = select_model(
        {
            "ml_dummy_baseline": trial([0.70, 0.71, 0.69, 0.70, 0.70]),
            "ml_linear_model": trial([0.52, 0.55, 0.50, 0.53, 0.51]),
        },
        baseline="ml_dummy_baseline",
        metric="expected_cost",
        complexity={"ml_dummy_baseline": 0, "ml_linear_model": 1},
        baseline_role="floor",
        not_compared=[],
    )
    decision = SelectionDecision.model_validate_json(json.dumps(chosen))
    assert decision.winner == "ml_linear_model"
    assert decision.positive_share == pytest.approx(0.3)
    assert "mean expected cost (0.522" in decision.reason
    assert any(
        "30% of the train rows are bad" in limitation.root for limitation in decision.limitations
    )


def test_a_costed_model_measures_its_wrong_rows_from_the_cut_off() -> None:
    model = linear_model(risky(), **params(costs=COSTS))
    test = risky(seed=1)
    m = evaluate(model, test, target="y", task="classification")["metrics"]
    bad = list(model.classes_).index("bad")
    p_bad = model.predict_proba(test.select("x"))[:, bad]
    assert m["error_margins"]["kind"] == "cut_off"
    for row in m["misclassified_sample"]["rows"]:
        assert row["margin"] == pytest.approx(abs(p_bad[row["row"]] - model.threshold))
