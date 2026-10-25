"""Models fit on the training table. A model step fits only the model (ADR-0056): Clean
steps before it encode text and fill gaps, each fit on the train rows."""

from collections.abc import Sequence
from typing import Any

import polars as pl
from scipy import sparse
from sklearn.base import BaseEstimator
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression

from .costs import costed, fixed, resolved

CATEGORIES = (pl.String, pl.Categorical, pl.Enum, pl.Boolean)
# A matrix as steps pass it (ADR-0058): a SciPy sparse matrix and its column names.
Words = tuple[Any, Sequence[str]]


def dummy_baseline(
    train: pl.DataFrame,
    target: str,
    task: str,
    features: list[str] | None = None,
    costs: dict[str, Any] | None = None,
    exclude: list[str] | None = None,
    words: Words | None = None,
) -> Any:
    """Always predicts the most frequent class, or the mean. Any real model should beat it.
    With `costs`, the class whose prediction for every row costs least."""
    model = dummy_baseline_estimator(task)
    return fit(model, train, target, features, costs, exclude=exclude, words=words)


def dummy_baseline_estimator(task: str) -> BaseEstimator:
    if task == "classification":
        return DummyClassifier(strategy="most_frequent")
    return DummyRegressor(strategy="mean")


def linear_model(
    train: pl.DataFrame,
    target: str,
    task: str,
    features: list[str] | None = None,
    costs: dict[str, Any] | None = None,
    exclude: list[str] | None = None,
    words: Words | None = None,
) -> Any:
    """Logistic regression for classes, linear regression for numbers. With `costs`, it
    predicts a class by the threshold that costs least on its training rows."""
    model = linear_model_estimator(task)
    return fit(model, train, target, features, costs, exclude=exclude, words=words)


def linear_model_estimator(task: str) -> BaseEstimator:
    if task == "classification":
        return LogisticRegression(max_iter=1000)
    return LinearRegression()


def random_forest(
    train: pl.DataFrame,
    target: str,
    task: str,
    features: list[str] | None = None,
    n_estimators: int = 200,
    seed: int = 0,
    min_samples_leaf: int = 1,
    max_features: float | None = None,
    costs: dict[str, Any] | None = None,
    exclude: list[str] | None = None,
    words: Words | None = None,
) -> Any:
    """A forest of decision trees; captures interactions a linear model misses. With `costs`,
    it predicts a class by the threshold that costs least on its training rows."""
    model = random_forest_estimator(task, n_estimators, seed, min_samples_leaf, max_features)
    return fit(model, train, target, features, costs, seed, exclude, words)


def random_forest_estimator(
    task: str,
    n_estimators: int = 200,
    seed: int = 0,
    min_samples_leaf: int = 1,
    max_features: float | None = None,
) -> BaseEstimator:
    """`max_features` is the share of features each split may look at; unset, each task keeps
    scikit-learn's default."""
    forest = RandomForestClassifier if task == "classification" else RandomForestRegressor
    settings: dict[str, Any] = {"min_samples_leaf": min_samples_leaf}
    if max_features is not None:
        settings["max_features"] = max_features
    # Every core grows trees; the seed fixes each tree, so the forest is the same on any number.
    # Its threads add their trees' votes in any order, so a probability may differ in its last
    # bits between runs.
    return forest(n_estimators=n_estimators, random_state=seed, n_jobs=-1, **settings)


def fit(
    model: BaseEstimator,
    train: pl.DataFrame,
    target: str,
    features: list[str] | None,
    costs: dict[str, Any] | None = None,
    seed: int = 0,
    exclude: list[str] | None = None,
    words: Words | None = None,
) -> Any:
    """`model` fit on the train rows, and on `words` beside them when given (ADR-0058). With
    `costs` (ADR-0053), it first tunes its threshold for least cost on its own training rows."""
    if features is not None and target in features:
        raise ValueError(f"target {target!r} is listed as a feature")
    if train[target].null_count():
        raise ValueError(f"{target} has {train[target].null_count()} missing values in train")
    table = model_input(train.drop(target), features, exclude)
    x, y = side_by_side(table, words, train.height), train[target].to_numpy()
    if not costs:
        fitted = model.fit(x, y)
    else:
        by_class = resolved(costs, y, target)
        fitted = fixed(costed(model, by_class, seed).fit(x, y), x, y, by_class["positive"])
        # Saved with the model, so its evaluation scores the cost it was chosen by.
        fitted.costs_ = costs
    if words is not None:
        # A sparse fit keeps no column names: its scoring needs the same columns and words.
        fitted.features_ = table.columns
        fitted.words_ = tuple(words[1])
    return fitted


def side_by_side(table: pl.DataFrame, words: Words | None, rows: int) -> Any:
    """The table's numbers with the words beside them, as one sparse matrix: row i of the
    words is row i of the table (ADR-0058). Without words, the table itself. `rows` is the
    table's row count, which a table with no columns left does not keep."""
    if words is None:
        return table
    values = words[0]
    if values.shape[0] != rows:
        raise ValueError(f"words have {values.shape[0]} rows but the table has {rows}")
    numbers = sparse.csr_array(table.to_numpy().astype(float).reshape(rows, -1))
    return sparse.hstack([numbers, values], format="csr")


def fold_input(x: Any, features: list[str] | None) -> Any:
    """A fold's model input: the prepared table's numbers, with the words a preparation step
    made in that fold beside them (ADR-0058)."""
    if not isinstance(x, tuple):
        return model_input(x, features)
    table, words = x
    # A table whose every column became words keeps no row count; the words have it.
    rows = table.height if table.width else words[0].shape[0]
    return side_by_side(model_input(table, features), words, rows)


def scoring_input(model: Any, rows: pl.DataFrame, words: Words | None) -> Any:
    """`rows` as `model` was fit on them: its table columns, and its words when it was fit on
    words. Other words would hand the model inputs it never learnt, so they are refused."""
    fitted_words = getattr(model, "words_", None)
    if fitted_words is None:
        if words is not None:
            raise ValueError("the model was fit without words; leave its words input unconnected")
        # The model selects exactly the columns it was fit on.
        return rows.select(list(model.feature_names_in_))
    if words is None:
        raise ValueError(
            "the model was fit on words; connect the test words of its Vectorize text step"
        )
    if tuple(words[1]) != fitted_words:
        raise ValueError(
            "these are not the words the model was fit on; connect the test words of the "
            "Vectorize text step its train words came from"
        )
    return side_by_side(rows.select(model.features_), words, rows.height)


def model_input(
    rows: pl.DataFrame, features: list[str] | None, exclude: list[str] | None = None
) -> pl.DataFrame:
    """The columns a model fits on: `features`, or every column of `rows` but the `exclude`d
    ones, the columns that identify rows, groups or time. They must be numbers with no gaps
    (ADR-0056); anything else is refused, naming the step to add."""
    left_out = exclude or []
    if features is not None and (both := [c for c in features if c in left_out]):
        raise ValueError(f"{', '.join(both)} is excluded, so it cannot be a feature")
    x = rows.drop(left_out, strict=False) if features is None else rows.select(features)
    categories = [c for c, kind in x.schema.items() if kind in CATEGORIES]
    if categories:
        raise ValueError(f"{_not_numbers(categories)}: add an Encode step before the model")
    other = [c for c, kind in x.schema.items() if not kind.is_numeric()]
    if other:
        raise ValueError(
            f"{_not_numbers(other)}: leave it out with a Select columns step, or list the "
            "model's features"
        )
    gaps = [c for c in x.columns if x[c].null_count()]
    if gaps:
        has = "has" if len(gaps) == 1 else "have"
        raise ValueError(
            f"{', '.join(gaps)} {has} missing values: add an Impute or Drop missing step "
            "before the model"
        )
    return x


def _not_numbers(columns: list[str]) -> str:
    if len(columns) == 1:
        return f"{columns[0]} is not a number"
    return f"{', '.join(columns)} are not numbers"


def random_forest_as_code(
    settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]
) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test checks it predicts as
    the step does."""
    forest = (
        "RandomForestClassifier"
        if settings["task"] == "classification"
        else "RandomForestRegressor"
    )
    options = [
        f"n_estimators={settings.get('n_estimators', 200)!r}",
        f"random_state={settings.get('seed', 0)!r}",
        f"min_samples_leaf={settings.get('min_samples_leaf', 1)!r}",
    ]
    if settings.get("max_features") is not None:
        options.append(f"max_features={settings['max_features']!r}")
    estimator = (f"from sklearn.ensemble import {forest}", f"{forest}({', '.join(options)})")
    return _model_code(settings, inputs, outputs, estimator, tuned=True)


def linear_model_as_code(
    settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]
) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test checks it predicts as
    the step does."""
    if settings["task"] == "classification":
        estimator = (
            "from sklearn.linear_model import LogisticRegression",
            "LogisticRegression(max_iter=1000)",
        )
    else:
        estimator = ("from sklearn.linear_model import LinearRegression", "LinearRegression()")
    return _model_code(settings, inputs, outputs, estimator, tuned=True)


def dummy_baseline_as_code(
    settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]
) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test checks it predicts as
    the step does. With costs it predicts by its class shares, so it cannot be tuned: its
    cut-off is fixed where approving and refusing everyone cost the same (ADR-0053)."""
    if settings["task"] != "classification":
        estimator = ("from sklearn.dummy import DummyRegressor", 'DummyRegressor(strategy="mean")')
    elif settings.get("costs"):
        estimator = (
            "from sklearn.dummy import DummyClassifier",
            'DummyClassifier(strategy="prior")',
        )
    else:
        estimator = (
            "from sklearn.dummy import DummyClassifier",
            'DummyClassifier(strategy="most_frequent")',
        )
    return _model_code(settings, inputs, outputs, estimator, tuned=False)


def _model_code(
    settings: dict[str, Any],
    inputs: dict[str, str],
    outputs: dict[str, str],
    estimator: tuple[str, str],
    tuned: bool,
) -> str:
    """A model step as plain Python: `estimator` (its import and its expression) fit on the
    train rows' features, or every column but the target and the excluded ones. With costs,
    the cut-off is tuned (`tuned`) or fixed by the costs alone. Helper names start with the
    model's own name, so they never replace a person's names."""
    train, model, target = inputs["train"], outputs["model"], settings["target"]
    features = settings.get("features")
    left_out = [target, *settings.get("exclude", [])]
    rows = f"{train}.drop({left_out!r})" if features is None else f"{train}.select({features!r})"
    fit = f"{rows}, {train}[{target!r}]"
    code = f"{estimator[0]}\n\n{model} = {estimator[1]}\n"
    if "words" in inputs:
        # The words a vectorizer made, beside the table's numbers, row for row (ADR-0058).
        x = f"{model}_x"
        code = (
            "from scipy import sparse\n"
            f"{code}\n"
            "# The table's numbers with the words beside them, row for row.\n"
            f"{x} = sparse.hstack([\n"
            f"    sparse.csr_array({rows}.to_numpy().astype(float).reshape({train}.height, -1)),\n"
            f"    {inputs['words']},\n"
            '], format="csr")\n'
            "# The table columns it reads beside its words: its evaluation reads the same.\n"
            f"{model}_columns = {rows}.columns\n"
        )
        fit = f"{x}, {train}[{target!r}]"
    costs = settings.get("costs") if settings["task"] == "classification" else None
    if not costs:
        return code + f"{model}.fit({fit})\n"
    # Costs name a class by its text, so "1" names the number 1, as the step resolves it.
    positive = f"{model}_positive"
    missing = f"{costs['positive']!r} is not one of the classes of {target}"
    code += (
        "\n"
        f"# The class the costs name, as {train}[{target!r}] holds it.\n"
        f"{positive} = next(\n"
        f"    (c for c in {train}[{target!r}].unique() if str(c) == {costs['positive']!r}),\n"
        "    None,\n"
        ")\n"
        f"if {positive} is None:\n"
        f"    raise ValueError({missing!r})\n"
    )
    if not tuned:
        return code + _fixed_code(model, fit, costs, positive)
    return code + _costed_code(model, fit, costs, positive, settings.get("seed", 0))


def _fixed_code(model: str, fit: str, costs: dict[str, Any], positive: str) -> str:
    """A cut-off set by the costs alone, for a model whose scores cannot be tuned (ADR-0053)."""
    fn, fp = costs["false_negative"], costs["false_positive"]
    return (
        "\n"
        "from sklearn.model_selection import FixedThresholdClassifier\n"
        "\n"
        # Labels are dataset text (rule 7): quoted with repr, never pasted into code.
        f"# Predict {costs['positive']!r} when its share is at least {fp!r} / ({fp!r} + {fn!r}).\n"
        f"{model} = FixedThresholdClassifier(\n"
        f"    {model}, threshold={fp / (fp + fn)!r}, pos_label={positive}\n"
        f").fit({fit})\n"
    )


def _costed_code(model: str, fit: str, costs: dict[str, Any], positive: str, seed: int) -> str:
    """The cut-off tuned for least cost on the model's own training rows (ADR-0053)."""
    fn, fp = costs["false_negative"], costs["false_positive"]
    return (
        "\n"
        "import numpy as np\n"
        "from sklearn.frozen import FrozenEstimator\n"
        "from sklearn.metrics import make_scorer\n"
        "from sklearn.model_selection import (\n"
        "    FixedThresholdClassifier, StratifiedKFold, TunedThresholdClassifierCV,\n"
        ")\n"
        "\n"
        "\n"
        f"def {model}_cost(y_true, y_pred, pos_label):\n"
        f"    # Mean cost per row: a missed {costs['positive']!r} costs {fn!r},\n"
        f"    # a false alarm {fp!r}.\n"
        "    truth, said = np.asarray(y_true) == pos_label, np.asarray(y_pred) == pos_label\n"
        f"    missed, alarms = (truth & ~said).sum(), (~truth & said).sum()\n"
        f"    return float(({fn!r} * missed + {fp!r} * alarms) / len(truth))\n"
        "\n"
        "\n"
        "# The cut-off is tuned on 3 folds of the training rows only.\n"
        f"{model}_tuned = TunedThresholdClassifierCV(\n"
        f"    {model},\n"
        f"    scoring=make_scorer({model}_cost, greater_is_better=False, pos_label={positive}),\n"
        f"    cv=StratifiedKFold(3, shuffle=True, random_state={seed!r}),\n"
        f").fit({fit})\n"
        f"{model} = FixedThresholdClassifier(\n"
        f"    FrozenEstimator({model}_tuned.estimator_),\n"
        f"    threshold=float({model}_tuned.best_threshold_),\n"
        f"    pos_label={positive},\n"
        f").fit({fit})\n"
    )
