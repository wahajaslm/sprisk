import json
from typing import Any

import numpy as np
import polars as pl
import pytest
from sklearn import metrics
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.datasets import make_classification
from sklearn.ensemble import VotingClassifier
from sklearn.linear_model import LogisticRegression, RidgeClassifier
from test_linear_model import CLF, with_missing_target

from sprisk_contracts import ClassificationReport
from sprisk_ml.evaluate import evaluate
from sprisk_ml.models import linear_model


def test_regression_reports_error_metrics() -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    model = linear_model(df[::2], target="y", features=["x"], task="regression")
    m = evaluate(model, df[1::2], target="y", task="regression")["metrics"]
    assert m["rmse"] == pytest.approx(0.0, abs=1e-6)
    assert {"rmse", "mae", "r2"} <= set(m)


def test_missing_target_in_test_is_an_error(clf_numbers: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="missing values in test"):
        evaluate(
            linear_model(clf_numbers, **CLF),
            with_missing_target(clf_numbers),
            target="y",
            task="classification",
        )


def test_task_mismatch_between_model_and_evaluate_is_an_error(clf_numbers: pl.DataFrame) -> None:
    with pytest.raises(ValueError, match="not a regression model"):
        evaluate(linear_model(clf_numbers, **CLF), clf_numbers, target="y", task="regression")


def test_classification_reports_a_confusion_matrix(clf_numbers: pl.DataFrame) -> None:
    m = evaluate(linear_model(clf_numbers, **CLF), clf_numbers, target="y", task="classification")[
        "metrics"
    ]
    confusion = m["confusion"]
    assert confusion["labels"] == sorted(confusion["labels"])
    assert sum(map(sum, confusion["matrix"])) == clf_numbers.height


def test_feature_importance_ranks_the_informative_feature_first(clf_numbers: pl.DataFrame) -> None:
    from sprisk_ml.importance import feature_importance

    table = feature_importance(linear_model(clf_numbers, **CLF), clf_numbers, target="y", seed=0)[
        "importance"
    ]
    assert table.columns == ["feature", "importance", "std"]
    assert table["feature"][0] == "x"


def test_feature_importance_needs_a_complete_target(clf_numbers: pl.DataFrame) -> None:
    from sprisk_ml.importance import feature_importance

    with pytest.raises(ValueError, match="missing values in test"):
        feature_importance(
            linear_model(clf_numbers, **CLF), with_missing_target(clf_numbers), target="y"
        )


def test_classification_draws_the_confusion_matrix(clf_numbers: pl.DataFrame) -> None:
    out = evaluate(linear_model(clf_numbers, **CLF), clf_numbers, target="y", task="classification")
    [figure] = out["figures"]
    assert figure.data[0].type == "heatmap"
    assert figure.layout.title.text == "Confusion matrix"


def test_regression_draws_predicted_against_actual() -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    model = linear_model(df[::2], target="y", features=["x"], task="regression")
    [figure] = evaluate(model, df[1::2], target="y", task="regression")["figures"]
    assert figure.layout.title.text == "Predicted against actual"


def test_feature_importance_draws_a_bar_per_feature(clf_numbers: pl.DataFrame) -> None:
    from sprisk_ml.importance import feature_importance

    out = feature_importance(linear_model(clf_numbers, **CLF), clf_numbers, target="y", seed=0)
    assert out["importance"]["feature"][0] == "x"
    [figure] = out["figures"]
    assert (
        figure.data[0].type == "bar"
        and list(figure.data[0].y) == out["importance"]["feature"].to_list()
    )


def three_classes() -> tuple[pl.DataFrame, pl.DataFrame]:
    """300 seeded rows of three overlapping classes, so a linear model gets some wrong."""
    x, y = make_classification(
        n_samples=300,
        n_features=4,
        n_informative=3,
        n_redundant=0,
        n_classes=3,
        class_sep=0.6,
        random_state=0,
    )
    df = pl.DataFrame({f"f{i}": x[:, i] for i in range(4)}).with_columns(
        y=pl.Series(np.array(["a", "b", "c"])[y])
    )
    return df[:150], df[150:]


def fit_on(estimator: Any, train: pl.DataFrame) -> Any:
    return estimator.fit(train.drop("y"), train["y"].to_numpy())


def scored(estimator: Any) -> tuple[dict[str, Any], pl.DataFrame]:
    train, test = three_classes()
    model = fit_on(estimator, train)
    return evaluate(model, test, target="y", task="classification")["metrics"], test


def predicted(estimator: Any) -> tuple[np.ndarray, np.ndarray]:
    train, test = three_classes()
    model = fit_on(estimator, train)
    return test["y"].to_numpy(), model.predict(test.drop("y"))


def test_per_class_matches_sklearn_classification_report() -> None:
    m, _ = scored(LogisticRegression())
    y_true, y_pred = predicted(LogisticRegression())
    report = metrics.classification_report(y_true, y_pred, output_dict=True)
    assert [c["label"] for c in m["per_class"]] == ["a", "b", "c"]
    for c in m["per_class"]:
        expected = report[c["label"]]
        assert c["precision"] == pytest.approx(expected["precision"])
        assert c["recall"] == pytest.approx(expected["recall"])
        assert c["f1"] == pytest.approx(expected["f1-score"])
        assert c["support"] == expected["support"]


class Fixed(ClassifierMixin, BaseEstimator):  # type: ignore[misc]
    """Predicts the rows' `said` column: a model whose mistakes a test chooses."""

    def fit(self, x: pl.DataFrame, y: Any) -> "Fixed":
        self.classes_ = np.unique(y)
        self.feature_names_in_ = np.array(x.columns)
        return self

    def predict(self, x: pl.DataFrame) -> Any:
        return x["said"].to_numpy()


def said(truth: list[str], predicted: list[str]) -> dict[str, Any]:
    test = pl.DataFrame({"said": predicted, "y": truth})
    model = Fixed().fit(test.drop("y"), test["y"].to_numpy())
    out: dict[str, Any] = evaluate(model, test, target="y", task="classification")["metrics"]
    return out


def test_top_confusions_are_the_largest_off_diagonal_cells() -> None:
    m = said(list("aaabbc"), list("bbcaca"))
    assert m["top_confusions"] == [
        {"true": "a", "predicted": "b", "count": 2},
        {"true": "a", "predicted": "c", "count": 1},
        {"true": "b", "predicted": "a", "count": 1},
        {"true": "b", "predicted": "c", "count": 1},
        {"true": "c", "predicted": "a", "count": 1},
    ]


def test_top_confusions_keep_the_ten_largest() -> None:
    labels = "abcdef"
    # Every true class taken for every other once (30 cells), and a for b three times.
    truth = [t for t in labels for p in labels if t != p] + ["a", "a"]
    predicted = [p for t in labels for p in labels if t != p] + ["b", "b"]
    tops = said(truth, predicted)["top_confusions"]
    assert len(tops) == 10
    assert tops[0] == {"true": "a", "predicted": "b", "count": 3}


def test_a_model_with_no_scores_and_no_mistakes_reports_an_empty_sample() -> None:
    m = said(list("abc"), list("abc"))
    assert "error_margins" not in m
    assert m["misclassified_sample"] == {"rows": [], "n_total": 0}
    assert m["top_confusions"] == []


def test_a_few_mistakes_are_all_in_the_sample_in_table_order() -> None:
    m = said(list("aabbc"), list("abbac"))
    assert m["misclassified_sample"] == {
        "rows": [
            {"row": 1, "true": "a", "predicted": "b"},
            {"row": 3, "true": "b", "predicted": "a"},
        ],
        "n_total": 2,
    }


def test_no_mistakes_draw_no_margin_histogram() -> None:
    train, _ = three_classes()
    model = fit_on(LogisticRegression(), train)
    perfect = train.with_columns(y=pl.Series(model.predict(train.drop("y"))))
    m = evaluate(model, perfect, target="y", task="classification")["metrics"]
    assert "error_margins" not in m
    assert m["misclassified_sample"] == {"rows": [], "n_total": 0}


def test_error_margins_from_probabilities_are_a_histogram_of_misclassified_rows() -> None:
    m, test = scored(LogisticRegression())
    y_true, y_pred = predicted(LogisticRegression())
    margins = m["error_margins"]
    assert margins["kind"] == "proba"
    assert sum(margins["counts"]) == int((y_true != y_pred).sum())
    assert len(margins["edges"]) == len(margins["counts"]) + 1
    assert margins["edges"][0] >= 0


def test_error_margins_fall_back_to_the_decision_function() -> None:
    m, _ = scored(RidgeClassifier())
    y_true, y_pred = predicted(RidgeClassifier())
    margins = m["error_margins"]
    assert margins["kind"] == "decision"
    assert sum(margins["counts"]) == int((y_true != y_pred).sum())
    assert margins["edges"][0] >= 0


def test_a_model_with_no_scores_reports_no_error_margins() -> None:
    # A hard-voting ensemble has neither predict_proba nor decision_function.
    m, _ = scored(
        VotingClassifier([("r", RidgeClassifier()), ("l", LogisticRegression())], voting="hard")
    )
    assert "error_margins" not in m
    assert all("margin" not in row for row in m["misclassified_sample"]["rows"])


def test_misclassified_sample_is_small_deterministic_and_holds_no_feature_values() -> None:
    first, test = scored(LogisticRegression())
    again, _ = scored(LogisticRegression())
    y_true, y_pred = predicted(LogisticRegression())
    sample = first["misclassified_sample"]
    assert sample == again["misclassified_sample"]
    assert sample["n_total"] == int((y_true != y_pred).sum()) > 20
    assert len(sample["rows"]) == 20
    for row in sample["rows"]:
        assert set(row) == {"row", "true", "predicted", "margin"}
        assert row["true"] == y_true[row["row"]] != row["predicted"] == y_pred[row["row"]]
        assert row["margin"] >= 0


def test_regression_reports_none_of_the_classification_detail() -> None:
    df = pl.DataFrame({"x": [float(i) for i in range(40)], "y": [2.0 * i + 1 for i in range(40)]})
    model = linear_model(df[::2], target="y", features=["x"], task="regression")
    m = evaluate(model, df[1::2], target="y", task="regression")["metrics"]
    for field in ("per_class", "top_confusions", "error_margins", "misclassified_sample"):
        assert field not in m


def test_two_class_decision_margins_are_the_distance_from_the_boundary() -> None:
    train, test = (part.filter(pl.col("y") != "c") for part in three_classes())
    model = fit_on(RidgeClassifier(), train)
    m = evaluate(model, test, target="y", task="classification")["metrics"]
    wrong = test["y"].to_numpy() != model.predict(test.drop("y"))
    scores = model.decision_function(test.drop("y"))
    assert m["error_margins"]["kind"] == "decision"
    assert sum(m["error_margins"]["counts"]) == int(wrong.sum()) > 0
    for row in m["misclassified_sample"]["rows"]:
        assert row["margin"] == pytest.approx(abs(scores[row["row"]]))


@pytest.mark.parametrize(
    "estimator",
    [
        LogisticRegression(),
        RidgeClassifier(),
        VotingClassifier([("r", RidgeClassifier()), ("l", LogisticRegression())], voting="hard"),
    ],
    ids=["proba", "decision", "no-scores"],
)
def test_classification_metrics_are_a_classification_report(estimator: Any) -> None:
    m, _ = scored(estimator)
    ClassificationReport.model_validate_json(json.dumps(m, allow_nan=False))
