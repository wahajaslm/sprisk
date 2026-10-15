import datetime as dt
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from conftest import WriteParquet
from model_runs import CLF, fit, fit_and_score, with_null_target

from sprisk_ml.linear_model import linear_model
from sprisk_workers.errors import OperatorError


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


def test_null_target_in_train_is_an_operator_error(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    with pytest.raises(OperatorError) as e:
        fit(linear_model, CLF, write_parquet, out_dir, with_null_target(clf_frame))
    assert e.value.code == "null_target"
