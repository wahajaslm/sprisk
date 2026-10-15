import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import sklearn
import skops.io
from sklearn import metrics
from sklearn.base import is_classifier
from skops.io.exceptions import UntrustedTypesFoundException

from sprisk_workers.errors import OperatorError
from sprisk_workers.ops.tables import read_table
from sprisk_workers.output import JSON, Output

# skops trusts sklearn estimators by default. Anything beyond them and this list
# fails to load, so a tampered model file cannot run arbitrary code.
TRUSTED_TYPES = ["numpy.dtype"]


def evaluate(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
    """Score a fitted model on the test table. Never sees training rows."""
    target, task = params["target"], params["task"]
    try:
        model = skops.io.load(inputs["model"], trusted=TRUSTED_TYPES)
    except UntrustedTypesFoundException as e:
        raise OperatorError("untrusted_model", str(e)) from e
    if is_classifier(model) != (task == "classification"):
        raise OperatorError("task_mismatch", f"model is not a {task} model")
    # The model selects exactly the columns it was fit on.
    features = list(model.feature_names_in_)
    test = read_table(inputs["test"], [target, *features])
    if test[target].null_count():
        raise OperatorError("null_target", f"{target} has {test[target].null_count()} nulls")
    y_true = test[target].to_numpy()
    y_pred = model.predict(test.select(features))
    result: dict[str, Any] = {
        "n_rows": test.height,
        "estimator": type(model[-1]).__name__,
        "sklearn_version": sklearn.__version__,
    }
    if task == "classification":
        result["accuracy"] = float(metrics.accuracy_score(y_true, y_pred))
        result["balanced_accuracy"] = float(metrics.balanced_accuracy_score(y_true, y_pred))
        result["f1_macro"] = float(metrics.f1_score(y_true, y_pred, average="macro"))
    else:
        result["rmse"] = float(metrics.root_mean_squared_error(y_true, y_pred))
        result["mae"] = float(metrics.mean_absolute_error(y_true, y_pred))
        result["r2"] = float(metrics.r2_score(y_true, y_pred))
    path = out_dir / "metrics.json"
    path.write_text(json.dumps(result))
    return [Output(port="metrics", path=path, media_type=JSON)]
