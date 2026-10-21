from typing import Any

import numpy as np
import polars as pl
import pytest
import skops.io

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


def test_evaluate_reports_the_cut_off_of_a_costed_model() -> None:
    model = linear_model(risky(), **params(costs=COSTS))
    metrics = evaluate(model, risky(seed=1), target="y", task="classification")["metrics"]
    assert metrics["cut_off"] == {"positive": "bad", "at": pytest.approx(model.threshold)}
    assert metrics["estimator"] == "LogisticRegression"


def test_costs_need_two_classes_and_name_one_of_them() -> None:
    with pytest.raises(ValueError, match="'risky' is not one of the 2 classes of y"):
        linear_model(risky(), **params(costs={**COSTS, "positive": "risky"}))
    three = risky().with_columns(
        pl.when(pl.col("x") > 1).then(pl.lit("odd")).otherwise("y").alias("y")
    )
    with pytest.raises(ValueError, match="costs need two classes; y has 3"):
        linear_model(three, **params(costs=COSTS))
