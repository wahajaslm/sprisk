"""A model step's plain Python (ADR-0055) fits the model the step fits: same predictions. An
evaluation's plain Python scores it as the step does."""

from collections.abc import Callable
from typing import Any

import numpy as np
import polars as pl
import pytest
import skops.io
from hypothesis import given, settings
from hypothesis import strategies as st
from scipy import sparse
from sklearn import metrics

from sprisk_ml.evaluate import as_code as evaluate_as_code
from sprisk_ml.evaluate import evaluate
from sprisk_ml.models import (
    dummy_baseline,
    dummy_baseline_as_code,
    linear_model,
    linear_model_as_code,
    random_forest,
    random_forest_as_code,
)
from sprisk_workers.notebook_code import read_settings
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


@pytest.mark.parametrize(
    "write", [random_forest_as_code, linear_model_as_code, dummy_baseline_as_code]
)
@settings(max_examples=60, deadline=None)
@given(label=st.text(min_size=1), column=st.text(min_size=1))
def test_dataset_text_never_becomes_code(
    code_shape: Callable[[str], str], write: Any, label: str, column: str
) -> None:
    # Labels and column names come from the data (rule 7): quoted, never run.
    def code(positive: str, name: str) -> str:
        costs = {"positive": positive, "false_negative": 5.0, "false_positive": 1.0}
        settings_ = {"target": name, "features": [name], "task": "classification", "costs": costs}
        written: str = write(settings_, {"train": "rows"}, {"model": "model"})
        return written

    assert code_shape(code(label, column)) == code_shape(code("bad", "y"))


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


@pytest.mark.parametrize(("step", "write"), WRITERS)
@pytest.mark.parametrize("extra", [{}, {"costs": COSTS}], ids=str)
def test_the_code_with_words_predicts_as_the_step_does(
    clf_numbers: pl.DataFrame, step: Any, write: Any, extra: dict[str, Any]
) -> None:
    # In a notebook the words are the matrix the vectorizer returned (ADR-0058).
    shoe = (clf_numbers["y"] == "hi").cast(pl.Float64).to_numpy()
    words = sparse.csr_matrix(np.column_stack([shoe, 1 - shoe]))
    settings = {"target": "y", "task": "classification", **extra}
    namespace: dict[str, Any] = {"rows": clf_numbers, "rows_words": words}
    exec(write(settings, {"train": "rows", "words": "rows_words"}, {"model": "m"}), namespace)

    fitted = step(clf_numbers, **settings, words=(words, ["title:shoe", "title:hat"]))
    x = sparse.hstack([sparse.csr_array(clf_numbers.select("x", "c").to_numpy()), words])
    assert np.array_equal(namespace["m"].predict(x), fitted.predict(x))


HEADLINE = {
    "classification": ["accuracy", "balanced_accuracy", "f1_macro", "weighted_f1"],
    "regression": ["rmse", "mae", "r2"],
}


def scored_by_code(namespace: dict[str, Any], settings: dict[str, Any], words: bool) -> Any:
    inputs = {"model": "m", "test": "held_out", **({"words": "held_out_words"} if words else {})}
    code = evaluate_as_code(settings, inputs, {"metrics": "scores", "figures": "charts"})
    exec(code, namespace)
    return namespace["scores"]


@pytest.mark.parametrize(("step", "write"), WRITERS)
@pytest.mark.parametrize("extra", [{}, {"costs": COSTS}], ids=str)
def test_the_evaluation_code_scores_as_the_step_does(
    clf_numbers: pl.DataFrame, step: Any, write: Any, extra: dict[str, Any], capsys: Any
) -> None:
    settings: dict[str, Any] = {"target": "y", "task": "classification"}
    train, test = clf_numbers[::2], clf_numbers[1::2]
    namespace: dict[str, Any] = {"rows": train, "held_out": test}
    exec(write({**settings, **extra}, {"train": "rows"}, {"model": "m"}), namespace)

    scores = scored_by_code(namespace, settings, words=False)

    # The step's model predicts as the code's (above), and keeps the costs its evaluation reads.
    scored = evaluate(step(train, **settings, **extra), test, **settings)["metrics"]
    assert scores == {k: scored[k] for k in HEADLINE["classification"]}
    predicted = namespace["m"].predict(test.drop("y"))
    printed = capsys.readouterr().out
    assert metrics.classification_report(test["y"], predicted, zero_division=0) in printed
    assert str(metrics.confusion_matrix(test["y"], predicted)) in printed


def test_the_regression_evaluation_code_scores_as_the_step_does(
    clf_numbers: pl.DataFrame,
) -> None:
    rows = clf_numbers.drop("y").with_columns(t=pl.col("x") * 2 + pl.col("c"))
    settings: dict[str, Any] = {"target": "t", "task": "regression"}
    namespace: dict[str, Any] = {"rows": rows[::2], "held_out": rows[1::2]}
    exec(linear_model_as_code(settings, {"train": "rows"}, {"model": "m"}), namespace)

    scores = scored_by_code(namespace, settings, words=False)

    step = evaluate(namespace["m"], rows[1::2], **settings)["metrics"]
    assert scores == {k: step[k] for k in HEADLINE["regression"]}


def test_the_evaluation_code_scores_a_model_with_words_as_the_step_does(
    clf_numbers: pl.DataFrame,
) -> None:
    # The test words are the matrix the vectorizer made from the test rows (ADR-0058).
    shoe = (clf_numbers["y"] == "hi").cast(pl.Float64).to_numpy()
    words = sparse.csr_matrix(np.column_stack([shoe, 1 - shoe]))
    settings: dict[str, Any] = {"target": "y", "task": "classification"}
    namespace: dict[str, Any] = {
        "rows": clf_numbers[::2],
        "rows_words": words[::2],
        "held_out": clf_numbers[1::2],
        "held_out_words": words[1::2],
    }
    names = {"train": "rows", "words": "rows_words"}
    exec(linear_model_as_code(settings, names, {"model": "m"}), namespace)

    scores = scored_by_code(namespace, settings, words=True)

    names_of_words = ["title:shoe", "title:hat"]
    fitted = linear_model(clf_numbers[::2], **settings, words=(words[::2], names_of_words))
    step = evaluate(fitted, clf_numbers[1::2], **settings, words=(words[1::2], names_of_words))
    assert scores == {k: step["metrics"][k] for k in HEADLINE["classification"]}


@settings(max_examples=60, deadline=None)
@given(column=st.text(min_size=1))
def test_a_target_name_never_becomes_evaluation_code(
    code_shape: Callable[[str], str], column: str
) -> None:
    def code(name: str, words: dict[str, str]) -> str:
        values = {"target": name, "task": "classification"}
        inputs = {"model": "m", "test": "held_out", **words}
        return evaluate_as_code(values, inputs, {"metrics": "scores", "figures": "charts"})

    for words in ({}, {"words": "held_out_words"}):
        assert code_shape(code(column, words)) == code_shape(code("y", words))


def test_an_edited_target_in_the_evaluation_code_is_read_back_as_the_setting() -> None:
    values = {"target": "y", "task": "classification"}
    names = ({"model": "m", "test": "held_out"}, {"metrics": "scores", "figures": "charts"})
    edited = evaluate_as_code(values, *names).replace("['y']", "['label']")
    assert read_settings(evaluate_as_code, values, *names, edited) == {**values, "target": "label"}
