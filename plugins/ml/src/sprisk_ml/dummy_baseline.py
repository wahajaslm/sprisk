from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sklearn.dummy import DummyClassifier, DummyRegressor

from sprisk_ml.fit import fit_pipeline
from sprisk_workers.output import Output


def dummy_baseline(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    if params["task"] == "classification":
        return fit_pipeline(DummyClassifier(strategy="most_frequent"), params, inputs, out_dir)
    return fit_pipeline(DummyRegressor(strategy="mean"), params, inputs, out_dir)
