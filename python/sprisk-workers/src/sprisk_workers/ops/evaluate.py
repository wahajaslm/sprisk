import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import skops.io
from sklearn import metrics

from sprisk_workers.ops.tables import read_table
from sprisk_workers.output import JSON, Output

# skops trusts sklearn estimators by default. Anything beyond them and this list
# fails to load, so a tampered model file cannot run arbitrary code.
TRUSTED_TYPES = ["numpy.dtype"]


def evaluate(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
    """Score a fitted model on the test table. Never sees training rows."""
    target = params["target"]
    test = read_table(inputs["test"], [target])
    model = skops.io.load(inputs["model"], trusted=TRUSTED_TYPES)
    y_true = test[target].to_numpy()
    y_pred = model.predict(test.drop(target))
    result: dict[str, float | int] = {"n_rows": test.height}
    if params["task"] == "classification":
        result["accuracy"] = metrics.accuracy_score(y_true, y_pred)
        result["balanced_accuracy"] = metrics.balanced_accuracy_score(y_true, y_pred)
        result["f1_macro"] = metrics.f1_score(y_true, y_pred, average="macro")
    else:
        result["rmse"] = metrics.root_mean_squared_error(y_true, y_pred)
        result["mae"] = metrics.mean_absolute_error(y_true, y_pred)
        result["r2"] = metrics.r2_score(y_true, y_pred)
    path = out_dir / "metrics.json"
    path.write_text(json.dumps({k: float(v) if k != "n_rows" else v for k, v in result.items()}))
    return [Output(port="metrics", path=path, media_type=JSON)]
