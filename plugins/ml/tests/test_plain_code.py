"""A model step's plain Python (ADR-0055) fits the model the step fits: same predictions."""

import ast
from typing import Any

import numpy as np
import polars as pl
import pytest
import skops.io
from hypothesis import given, settings
from hypothesis import strategies as st

from sprisk_ml.models import (
    dummy_baseline,
    dummy_baseline_as_code,
    linear_model,
    linear_model_as_code,
    random_forest,
    random_forest_as_code,
)
from sprisk_workers.plain import TRUSTED_MODEL_TYPES

COSTS = {"positive": "hi", "false_negative": 5.0, "false_positive": 1.0}
WRITERS = [
    (random_forest, random_forest_as_code),
    (linear_model, linear_model_as_code),
    (dummy_baseline, dummy_baseline_as_code),
]


def fitted_by_code(
    settings: dict[str, Any], train: pl.DataFrame, write: Any = random_forest_as_code
) -> Any:
    namespace: dict[str, Any] = {"rows": train}
    exec(write(settings, {"train": "rows"}, {"model": "forest"}), namespace)
    return namespace["forest"]


@pytest.mark.parametrize(("step", "write"), WRITERS)
@pytest.mark.parametrize(
    "extra", [{}, {"features": ["c", "x"]}, {"costs": COSTS}, {"exclude": ["c"]}], ids=str
)
def test_the_code_predicts_as_the_step_does(
    clf_numbers: pl.DataFrame, step: Any, write: Any, extra: dict[str, Any]
) -> None:
    settings = {"target": "y", "task": "classification", **extra}
    used = [c for c in extra.get("features", ["x", "c"]) if c not in extra.get("exclude", [])]
    train, test = clf_numbers[::2], clf_numbers[1::2].select(used)
    fitted = step(train, **settings)
    code = fitted_by_code(settings, train, write)
    assert np.array_equal(code.predict(test), fitted.predict(test))


@pytest.mark.parametrize(("step", "write"), WRITERS)
def test_regression_code_predicts_as_the_step_does(
    clf_numbers: pl.DataFrame, step: Any, write: Any
) -> None:
    rows = clf_numbers.drop("y").with_columns(t=pl.col("x") * 2)
    settings = {"target": "t", "features": ["x", "c"], "task": "regression"}
    test = rows.select("x", "c")
    assert np.allclose(
        fitted_by_code(settings, rows, write).predict(test), step(rows, **settings).predict(test)
    )


def test_a_tuned_forest_code_predicts_as_the_step_does(clf_numbers: pl.DataFrame) -> None:
    settings: dict[str, Any] = {
        "target": "y",
        "task": "classification",
        **{"n_estimators": 30, "seed": 4, "min_samples_leaf": 3, "max_features": 0.5},
    }
    train, test = clf_numbers[::2], clf_numbers[1::2].drop("y")
    step = random_forest(train, **settings)
    assert np.array_equal(fitted_by_code(settings, train).predict(test), step.predict(test))


@pytest.mark.parametrize(("step", "write"), WRITERS)
@pytest.mark.parametrize("extra", [{}, {"costs": COSTS}])
def test_the_model_the_code_fits_saves_as_a_model_file(
    clf_numbers: pl.DataFrame, step: Any, write: Any, extra: dict[str, Any]
) -> None:
    # A person's code step saves its model the way a model step does: no function inside.
    model = fitted_by_code({"target": "y", "task": "classification", **extra}, clf_numbers, write)
    loaded = skops.io.loads(skops.io.dumps(model), trusted=TRUSTED_MODEL_TYPES)
    rows = clf_numbers.drop("y")
    assert np.array_equal(loaded.predict(rows), model.predict(rows))


def _shape(code: str) -> str:
    """The code's syntax tree with every string emptied: only what runs, not what is quoted."""
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            node.value = ""
    return ast.dump(tree)


@pytest.mark.parametrize(
    "write", [random_forest_as_code, linear_model_as_code, dummy_baseline_as_code]
)
@settings(max_examples=60, deadline=None)
@given(label=st.text(min_size=1), column=st.text(min_size=1))
def test_dataset_text_never_becomes_code(write: Any, label: str, column: str) -> None:
    # Labels and column names come from the data (rule 7): quoted, never run.
    def code(positive: str, name: str) -> str:
        costs = {"positive": positive, "false_negative": 5.0, "false_positive": 1.0}
        settings_ = {"target": name, "features": [name], "task": "classification", "costs": costs}
        written: str = write(settings_, {"train": "rows"}, {"model": "model"})
        return written

    assert _shape(code(label, column)) == _shape(code("bad", "y"))


@pytest.mark.parametrize(("step", "write"), WRITERS)
def test_costs_name_a_number_class_by_its_text_in_the_code_too(
    clf_numbers: pl.DataFrame, step: Any, write: Any
) -> None:
    # A 0/1 target: the costs name class 1 as "1", as they name any class (ADR-0053).
    rows = clf_numbers.with_columns(y=(pl.col("y") == "hi").cast(pl.Int64))
    costs = {"positive": "1", "false_negative": 5.0, "false_positive": 1.0}
    settings = {"target": "y", "task": "classification", "costs": costs}
    train, test = rows[::2], rows[1::2].drop("y")
    code = fitted_by_code(settings, train, write)
    assert np.array_equal(code.predict(test), step(train, **settings).predict(test))


@pytest.mark.parametrize("write", [w for _, w in WRITERS])
def test_costs_naming_no_class_fail_with_a_clear_error_in_the_code(
    clf_numbers: pl.DataFrame, write: Any
) -> None:
    costs = {"positive": "absent", "false_negative": 5.0, "false_positive": 1.0}
    settings = {"target": "y", "task": "classification", "costs": costs}
    with pytest.raises(ValueError, match="'absent' is not one of the classes of y"):
        fitted_by_code(settings, clf_numbers, write)
