import json
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from conftest import WriteParquet

from sprisk_workers.errors import OperatorError
from sprisk_workers.ops.evaluate import evaluate
from sprisk_workers.ops.model import dummy_baseline, linear_model
from sprisk_workers.output import JSON, SKOPS
from sprisk_workers.serve import OperatorFn


def fit_and_score(
    fit: OperatorFn,
    task: str,
    write: WriteParquet,
    out_dir: Path,
    train: pl.DataFrame,
    test: pl.DataFrame,
) -> dict[str, Any]:
    params = {"target": "y", "task": task}
    [model] = fit(params, {"train": write("train", train)}, out_dir)
    assert (model.port, model.media_type) == ("model", SKOPS)
    [metrics] = evaluate(params, {"model": model.path, "test": write("test", test)}, out_dir)
    assert (metrics.port, metrics.media_type) == ("metrics", JSON)
    result: dict[str, Any] = json.loads(metrics.path.read_text())
    return result


def test_logistic_beats_dummy_on_separable_data(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    train, test = clf_frame[::2], clf_frame[1::2]
    dummy = fit_and_score(dummy_baseline, "classification", write_parquet, out_dir, train, test)
    linear = fit_and_score(linear_model, "classification", write_parquet, out_dir, train, test)
    assert dummy["balanced_accuracy"] == pytest.approx(0.5)
    assert linear["accuracy"] > 0.9
    assert linear["n_rows"] == 30
    assert set(linear) == {"n_rows", "accuracy", "balanced_accuracy", "f1_macro"}


def test_regression_reports_error_metrics(write_parquet: WriteParquet, out_dir: Path) -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    m = fit_and_score(linear_model, "regression", write_parquet, out_dir, df[::2], df[1::2])
    assert m["rmse"] == pytest.approx(0.0, abs=1e-6)
    assert set(m) == {"n_rows", "rmse", "mae", "r2"}


def test_category_seen_only_in_test_does_not_break_prediction(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    # The encoder is fit on train only, so it has never seen "unseen".
    test = clf_frame[28:32].with_columns(pl.lit("unseen").alias("c"))
    m = fit_and_score(linear_model, "classification", write_parquet, out_dir, clf_frame, test)
    assert m["n_rows"] == 4


def test_missing_target_is_an_operator_error(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    train = write_parquet("t", clf_frame.drop("y"))
    with pytest.raises(OperatorError) as e:
        linear_model({"target": "y", "task": "classification"}, {"train": train}, out_dir)
    assert e.value.code == "missing_column"


def test_null_target_is_an_operator_error(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    df = clf_frame.with_columns(
        pl.when(pl.col("x") == 3).then(None).otherwise(pl.col("y")).alias("y")
    )
    with pytest.raises(OperatorError) as e:
        linear_model(
            {"target": "y", "task": "classification"}, {"train": write_parquet("t", df)}, out_dir
        )
    assert e.value.code == "null_target"
