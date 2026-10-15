from pathlib import Path

import polars as pl
import pytest
from conftest import CLF, WriteParquet, fit_and_score

from sprisk_ml.dummy_baseline import dummy_baseline
from sprisk_ml.linear_model import linear_model


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
