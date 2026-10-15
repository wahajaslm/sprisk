"""Fit-then-score helpers shared by the ml pack tests."""

import json
from pathlib import Path
from typing import Any

import polars as pl
from conftest import WriteParquet

from sprisk_ml.evaluate import evaluate
from sprisk_workers.output import JSON, SKOPS
from sprisk_workers.serve import OperatorFn

CLF = {"target": "y", "task": "classification", "features": ["x", "c"]}


def fit(
    fn: OperatorFn, params: dict[str, Any], write: WriteParquet, out_dir: Path, train: pl.DataFrame
) -> Path:
    [model] = fn(params, {"train": write("train", train)}, out_dir)
    assert (model.port, model.media_type) == ("model", SKOPS)
    return model.path


def score(
    params: dict[str, Any], model: Path, write: WriteParquet, out_dir: Path, test: pl.DataFrame
) -> dict[str, Any]:
    [metrics] = evaluate(params, {"model": model, "test": write("test", test)}, out_dir)
    assert (metrics.port, metrics.media_type) == ("metrics", JSON)
    result: dict[str, Any] = json.loads(metrics.path.read_text())
    return result


def fit_and_score(
    fn: OperatorFn,
    params: dict[str, Any],
    write: WriteParquet,
    out_dir: Path,
    train: pl.DataFrame,
    test: pl.DataFrame,
) -> dict[str, Any]:
    eval_params = {"target": params["target"], "task": params["task"]}
    return score(eval_params, fit(fn, params, write, out_dir, train), write, out_dir, test)


def with_null_target(df: pl.DataFrame) -> pl.DataFrame:
    return df.with_columns(pl.when(pl.col("x") == 3).then(None).otherwise(pl.col("y")).alias("y"))
