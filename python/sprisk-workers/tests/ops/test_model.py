import datetime as dt
import json
from pathlib import Path
from typing import Any

import polars as pl
import pytest
import skops.io
from conftest import WriteParquet

from sprisk_workers.errors import OperatorError
from sprisk_workers.ops.evaluate import evaluate
from sprisk_workers.ops.model import dummy_baseline, linear_model
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


def test_logistic_beats_dummy_on_separable_data(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    train, test = clf_frame[::2], clf_frame[1::2]
    dummy = fit_and_score(dummy_baseline, CLF, write_parquet, out_dir, train, test)
    linear = fit_and_score(linear_model, CLF, write_parquet, out_dir, train, test)
    assert dummy["balanced_accuracy"] == pytest.approx(0.5)
    assert dummy["estimator"] == "DummyClassifier"
    assert linear["accuracy"] > 0.9
    assert linear["n_rows"] == 30
    assert linear["estimator"] == "LogisticRegression"
    assert set(linear) == {
        "n_rows",
        "estimator",
        "sklearn_version",
        "accuracy",
        "balanced_accuracy",
        "f1_macro",
    }


def test_regression_reports_error_metrics(write_parquet: WriteParquet, out_dir: Path) -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    params = {"target": "y", "task": "regression", "features": ["x"]}
    m = fit_and_score(linear_model, params, write_parquet, out_dir, df[::2], df[1::2])
    assert m["rmse"] == pytest.approx(0.0, abs=1e-6)
    assert {"rmse", "mae", "r2"} <= set(m)


def test_only_listed_features_are_used(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    # A datetime split column next to the features must be ignored, not fit on.
    df = clf_frame.with_columns(
        pl.datetime_range(
            dt.datetime(2026, 1, 1),
            dt.datetime(2026, 1, 1) + dt.timedelta(hours=59),
            "1h",
            eager=True,
        ).alias("t")
    )
    m = fit_and_score(linear_model, CLF, write_parquet, out_dir, df[::2], df[1::2])
    assert m["accuracy"] > 0.9


def test_category_seen_only_in_test_does_not_break_prediction(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    # The encoder is fit on train only, so it has never seen "unseen".
    test = clf_frame[28:32].with_columns(pl.lit("unseen").alias("c"))
    m = fit_and_score(linear_model, CLF, write_parquet, out_dir, clf_frame, test)
    assert m["n_rows"] == 4


@pytest.mark.parametrize(
    ("params", "code"),
    [
        ({**CLF, "features": ["x", "missing"]}, "missing_column"),
        ({**CLF, "target": "missing"}, "missing_column"),
        ({**CLF, "features": ["x", "y"]}, "target_in_features"),
    ],
)
def test_bad_columns_are_operator_errors(
    params: dict[str, Any],
    code: str,
    write_parquet: WriteParquet,
    clf_frame: pl.DataFrame,
    out_dir: Path,
) -> None:
    with pytest.raises(OperatorError) as e:
        fit(linear_model, params, write_parquet, out_dir, clf_frame)
    assert e.value.code == code


def test_unsupported_feature_type_is_an_operator_error(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    df = clf_frame.with_columns(pl.lit(dt.date(2026, 1, 1)).alias("d"))
    with pytest.raises(OperatorError) as e:
        fit(linear_model, {**CLF, "features": ["x", "d"]}, write_parquet, out_dir, df)
    assert e.value.code == "unsupported_feature_type"


def with_null_target(df: pl.DataFrame) -> pl.DataFrame:
    return df.with_columns(pl.when(pl.col("x") == 3).then(None).otherwise(pl.col("y")).alias("y"))


def test_null_target_in_train_is_an_operator_error(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    with pytest.raises(OperatorError) as e:
        fit(linear_model, CLF, write_parquet, out_dir, with_null_target(clf_frame))
    assert e.value.code == "null_target"


def test_null_target_in_test_is_an_operator_error(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    model = fit(linear_model, CLF, write_parquet, out_dir, clf_frame)
    with pytest.raises(OperatorError) as e:
        score(
            {"target": "y", "task": "classification"},
            model,
            write_parquet,
            out_dir,
            with_null_target(clf_frame),
        )
    assert e.value.code == "null_target"


def test_task_mismatch_between_model_and_evaluate_is_an_operator_error(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    model = fit(linear_model, CLF, write_parquet, out_dir, clf_frame)
    with pytest.raises(OperatorError) as e:
        score({"target": "y", "task": "regression"}, model, write_parquet, out_dir, clf_frame)
    assert e.value.code == "task_mismatch"


def test_model_file_with_untrusted_types_is_refused(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path, tmp_path: Path
) -> None:
    evil = tmp_path / "evil.skops"
    skops.io.dump({"call": dt.datetime}, evil)
    with pytest.raises(OperatorError) as e:
        score({"target": "y", "task": "classification"}, evil, write_parquet, out_dir, clf_frame)
    assert e.value.code == "untrusted_model"
