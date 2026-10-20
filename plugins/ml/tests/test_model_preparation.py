"""Each model manifest's `model.prepares`, checked on the code. Preparation rules trust it to
skip an impute or scale step before the model, so a false claim breaks real flows."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import pytest
import yaml

from sprisk_ml.evaluate import evaluate
from sprisk_ml.importance import feature_importance
from sprisk_ml.models import dummy_baseline, linear_model, random_forest

OPERATORS = Path(__file__).parents[1] / "operators"
MODELS: dict[str, Callable[..., Any]] = {
    "linear_model": linear_model,
    "random_forest": random_forest,
    "dummy_baseline": dummy_baseline,
}
FEATURES = ["x", "i", "c", "b"]


def prepares(name: str) -> list[str]:
    manifest = yaml.safe_load((OPERATORS / name / "manifest.yaml").read_text())
    return list(manifest["model"]["prepares"])


def rows(n: int, seed: int) -> pl.DataFrame:
    """A float, an integer, a text and a boolean feature, each with every fifth value missing."""
    rng = np.random.default_rng(seed)
    x = rng.normal(size=n)
    gap = [k % 5 == 0 for k in range(n)]
    return pl.DataFrame(
        {
            "x": [None if g else float(v) for g, v in zip(gap, x, strict=True)],
            "i": [None if g else int(k % 7) for k, g in enumerate(gap)],
            "c": [None if g else "abc"[k % 3] for k, g in enumerate(gap)],
            "b": [None if g else k % 2 == 0 for k, g in enumerate(gap)],
            "y": (x > 0).astype(int),
        },
        schema={"x": pl.Float64, "i": pl.Int64, "c": pl.String, "b": pl.Boolean, "y": pl.Int64},
    )


def fit(name: str, train: pl.DataFrame) -> Any:
    return MODELS[name](train, target="y", features=FEATURES, task="classification")


@pytest.mark.parametrize("name", MODELS)
def test_a_model_that_fills_gaps_fills_every_kind_of_column_and_scores_rows_with_gaps(
    name: str,
) -> None:
    assert "fill_gaps" in prepares(name)
    train, test = rows(60, seed=1), rows(30, seed=2)
    model = fit(name, train)

    encoder = model.named_steps["preprocess"].named_transformers_["categorical"][-1]
    assert all(None not in categories for categories in encoder.categories_)
    assert not np.isnan(model.named_steps["preprocess"].transform(test.select(FEATURES))).any()
    assert evaluate(model, test, target="y", task="classification")["metrics"]["n_rows"] == 30
    assert feature_importance(model, test, target="y")["importance"].height == len(FEATURES)


@pytest.mark.parametrize("name", MODELS)
def test_a_model_that_standardizes_is_unchanged_by_affine_scaling_before_it(name: str) -> None:
    assert "standardize" in prepares(name)
    train, test = rows(60, seed=1), rows(30, seed=2)

    def rescale(frame: pl.DataFrame) -> pl.DataFrame:
        return frame.with_columns(pl.col("x") * 7.0 + 3.0, pl.col("i") * 2.5 - 1.0)

    raw = fit(name, train).predict_proba(test.select(FEATURES))
    scaled = fit(name, rescale(train)).predict_proba(rescale(test).select(FEATURES))
    np.testing.assert_allclose(raw, scaled, atol=1e-9)
