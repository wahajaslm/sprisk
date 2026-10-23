"""Models, Evaluate and importance take word features beside the table (ADR-0058)."""

from typing import Any

import numpy as np
import polars as pl
import pytest
from scipy import sparse

from sprisk_ml.evaluate import evaluate
from sprisk_ml.importance import feature_importance
from sprisk_ml.models import dummy_baseline, linear_model, random_forest

N = 40
# The class shows only in the words: "shoe" rows are 1, "hat" rows are 0. x is noise.
TABLE = pl.DataFrame({"x": [float(i % 7) for i in range(N)], "y": [i % 2 for i in range(N)]})
NAMES = ("title:hat", "title:shoe")


def words(rows: pl.DataFrame) -> tuple[Any, tuple[str, ...]]:
    shoe = np.array(rows["y"].to_list(), dtype=float)
    return sparse.csr_matrix(np.column_stack([1 - shoe, shoe])), NAMES


CLF = {"target": "y", "task": "classification"}


@pytest.mark.parametrize("model", [linear_model, random_forest])
def test_a_model_learns_from_the_words_beside_the_table(model: Any) -> None:
    fitted = model(TABLE, **CLF, words=words(TABLE))
    scored = evaluate(fitted, TABLE, **CLF, words=words(TABLE))["metrics"]
    assert scored["accuracy"] == 1.0


def test_a_model_fits_on_words_alone_when_the_table_has_only_the_target() -> None:
    fitted = linear_model(TABLE.select("y"), **CLF, words=words(TABLE))
    assert evaluate(fitted, TABLE.select("y"), **CLF, words=words(TABLE))["metrics"][
        "accuracy"
    ] == pytest.approx(1.0)


def test_the_baseline_takes_words_and_ignores_them() -> None:
    fitted = dummy_baseline(TABLE, **CLF, words=words(TABLE))
    assert evaluate(fitted, TABLE, **CLF, words=words(TABLE))["metrics"]["accuracy"] == 0.5


def test_words_whose_rows_differ_from_the_table_are_refused() -> None:
    with pytest.raises(ValueError, match="words have 40 rows but the table has 20"):
        linear_model(TABLE.head(20), **CLF, words=words(TABLE))


def test_a_model_fit_on_words_is_scored_only_with_the_same_words() -> None:
    fitted = linear_model(TABLE, **CLF, words=words(TABLE))
    with pytest.raises(ValueError, match="fit on words; connect the test words"):
        evaluate(fitted, TABLE, **CLF)
    other = (words(TABLE)[0], ("title:cap", "title:shoe"))
    with pytest.raises(ValueError, match="not the words the model was fit on"):
        evaluate(fitted, TABLE, **CLF, words=other)


def test_a_model_fit_without_words_refuses_them() -> None:
    fitted = linear_model(TABLE, **CLF)
    with pytest.raises(ValueError, match="fit without words"):
        evaluate(fitted, TABLE, **CLF, words=words(TABLE))


def test_importance_shuffles_each_text_columns_words_as_one_feature() -> None:
    fitted = linear_model(TABLE, **CLF, words=words(TABLE))
    table = feature_importance(fitted, TABLE, target="y", words=words(TABLE))["importance"]
    by_feature = dict(zip(table["feature"], table["importance"], strict=True))
    assert set(by_feature) == {"x", "title"}
    assert by_feature["title"] > 0.3
    assert by_feature["title"] > by_feature["x"]


def test_a_text_column_whose_name_holds_a_colon_is_one_feature() -> None:
    names = ("a:b:hat", "a:b:shoe")
    fitted = linear_model(TABLE, **CLF, words=(words(TABLE)[0], names))
    table = feature_importance(fitted, TABLE, target="y", words=(words(TABLE)[0], names))
    assert set(table["importance"]["feature"]) == {"x", "a:b"}
