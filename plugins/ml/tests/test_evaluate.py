import datetime as dt
from pathlib import Path

import polars as pl
import pytest
import skops.io
from conftest import WriteParquet
from model_runs import CLF, fit, fit_and_score, score, with_null_target

from sprisk_ml.linear_model import linear_model
from sprisk_workers.errors import OperatorError


def test_regression_reports_error_metrics(write_parquet: WriteParquet, out_dir: Path) -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    params = {"target": "y", "task": "regression", "features": ["x"]}
    m = fit_and_score(linear_model, params, write_parquet, out_dir, df[::2], df[1::2])
    assert m["rmse"] == pytest.approx(0.0, abs=1e-6)
    assert {"rmse", "mae", "r2"} <= set(m)


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
