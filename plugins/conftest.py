import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from sprisk_ml.evaluate import evaluate
from sprisk_workers.output import JSON, SKOPS
from sprisk_workers.serve import OperatorFn

WriteParquet = Callable[[str, pl.DataFrame], Path]


@pytest.fixture
def out_dir(tmp_path: Path) -> Path:
    path = tmp_path / "staging"
    path.mkdir()
    return path


@pytest.fixture
def write_parquet(tmp_path: Path) -> WriteParquet:
    def write(name: str, df: pl.DataFrame) -> Path:
        path = tmp_path / f"{name}.parquet"
        df.write_parquet(path)
        return path

    return write


@pytest.fixture
def clf_frame() -> pl.DataFrame:
    """60 rows. x drives y; c is categorical noise; x has one missing value."""
    n = 60
    return pl.DataFrame(
        {
            "x": [None, *[float(i) for i in range(1, n)]],
            "c": ["a" if i % 2 else "b" for i in range(n)],
            "y": ["hi" if i >= n // 2 else "lo" for i in range(n)],
        }
    )


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


def run_split(
    fn: OperatorFn, params: dict[str, object], write: WriteParquet, out_dir: Path, df: pl.DataFrame
) -> tuple[pl.DataFrame, pl.DataFrame]:
    outs = {o.port: pl.read_parquet(o.path) for o in fn(params, {"data": write("d", df)}, out_dir)}
    return outs["train"], outs["test"]
