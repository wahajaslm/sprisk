from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sklearn.linear_model import LinearRegression, LogisticRegression

from sprisk_ml.fit import fit_pipeline
from sprisk_workers.output import Output


def linear_model(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    if params["task"] == "classification":
        return fit_pipeline(LogisticRegression(max_iter=1000), params, inputs, out_dir)
    return fit_pipeline(LinearRegression(), params, inputs, out_dir)
