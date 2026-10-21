"""Models fit on the training table: preprocessing and estimator together, so nothing about
the test rows is learned."""

from typing import Any

import numpy as np
import polars as pl
import polars.selectors as cs
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .costs import costed, fixed, resolved


def dummy_baseline(
    train: pl.DataFrame,
    target: str,
    features: list[str],
    task: str,
    costs: dict[str, Any] | None = None,
) -> Any:
    """Always predicts the most frequent class, or the mean. Any real model should beat it.
    With `costs`, the class whose prediction for every row costs least."""
    model = dummy_baseline_estimator(train.select(features).schema, task)
    return fit(model, train, target, features, costs)


def dummy_baseline_estimator(schema: pl.Schema, task: str) -> Pipeline:
    estimator = (
        DummyClassifier(strategy="most_frequent")
        if task == "classification"
        else DummyRegressor(strategy="mean")
    )
    return Pipeline([("preprocess", preprocessor(schema, scale=True)), ("estimator", estimator)])


def linear_model(
    train: pl.DataFrame,
    target: str,
    features: list[str],
    task: str,
    costs: dict[str, Any] | None = None,
) -> Any:
    """Logistic regression for classes, linear regression for numbers. With `costs`, it
    predicts a class by the threshold that costs least on its training rows."""
    model = linear_model_estimator(train.select(features).schema, task)
    return fit(model, train, target, features, costs)


def linear_model_estimator(schema: pl.Schema, task: str) -> Pipeline:
    estimator = (
        LogisticRegression(max_iter=1000) if task == "classification" else LinearRegression()
    )
    return Pipeline([("preprocess", preprocessor(schema, scale=True)), ("estimator", estimator)])


def random_forest(
    train: pl.DataFrame,
    target: str,
    features: list[str],
    task: str,
    n_estimators: int = 200,
    seed: int = 0,
    min_samples_leaf: int = 1,
    max_features: float | None = None,
    costs: dict[str, Any] | None = None,
) -> Any:
    """A forest of decision trees; captures interactions a linear model misses. With `costs`,
    it predicts a class by the threshold that costs least on its training rows."""
    model = random_forest_estimator(
        train.select(features).schema, task, n_estimators, seed, min_samples_leaf, max_features
    )
    return fit(model, train, target, features, costs, seed)


def random_forest_estimator(
    schema: pl.Schema,
    task: str,
    n_estimators: int = 200,
    seed: int = 0,
    min_samples_leaf: int = 1,
    max_features: float | None = None,
) -> Pipeline:
    """`max_features` is the share of features each split may look at; unset, each task keeps
    scikit-learn's default."""
    forest = RandomForestClassifier if task == "classification" else RandomForestRegressor
    settings: dict[str, Any] = {"min_samples_leaf": min_samples_leaf}
    if max_features is not None:
        settings["max_features"] = max_features
    # Trees split on rank order, so scaling would change nothing.
    return Pipeline(
        [
            ("preprocess", preprocessor(schema, scale=False)),
            ("estimator", forest(n_estimators=n_estimators, random_state=seed, **settings)),
        ]
    )


def fit(
    model: Pipeline,
    train: pl.DataFrame,
    target: str,
    features: list[str],
    costs: dict[str, Any] | None = None,
    seed: int = 0,
) -> Any:
    """`model` fit on the train rows. With `costs` (ADR-0053), it first tunes its threshold
    for least cost on its own training rows."""
    if target in features:
        raise ValueError(f"target {target!r} is listed as a feature")
    if train[target].null_count():
        raise ValueError(f"{target} has {train[target].null_count()} missing values in train")
    x, y = train.select(features), train[target].to_numpy()
    if not costs:
        return model.fit(x, y)
    by_class = resolved(costs, y, target)
    fitted = fixed(costed(model, by_class, seed).fit(x, y), x, y, by_class["positive"])
    # Saved with the model, so its evaluation scores the cost it was chosen by.
    fitted.costs_ = costs
    return fitted


class AsObject(TransformerMixin, BaseEstimator):  # type: ignore[misc]
    """Category columns as an object array. Its own class with no settings, so a model file
    names only this type: skops would let a file that names a numpy function call it."""

    def fit(self, x: Any, y: Any = None) -> "AsObject":
        return self

    def transform(self, x: Any) -> Any:
        return np.asarray(x, dtype=object)


def preprocessor(schema: pl.Schema, scale: bool) -> ColumnTransformer:
    """Numbers: fill gaps with the median, then standardise if `scale`. Text: fill with the
    most frequent value, then one-hot encode; a category seen only in test is ignored."""
    numeric = list(cs.expand_selector(schema, cs.numeric()))
    categorical = list(cs.expand_selector(schema, cs.string() | cs.categorical() | cs.boolean()))
    unsupported = sorted(set(schema) - set(numeric) - set(categorical))
    if unsupported:
        raise ValueError(f"columns {unsupported} are not numeric or categorical")
    numbers = SimpleImputer(strategy="median")
    return ColumnTransformer(
        [
            ("numeric", make_pipeline(numbers, StandardScaler()) if scale else numbers, numeric),
            (
                "categorical",
                make_pipeline(
                    # A gap-free boolean column arrives as a bool array, which the imputer
                    # refuses; as objects, every category column looks the same to it.
                    AsObject(),
                    # Polars text and boolean gaps reach sklearn as None, not NaN.
                    SimpleImputer(missing_values=None, strategy="most_frequent"),
                    OneHotEncoder(handle_unknown="ignore"),
                ),
                categorical,
            ),
        ]
    )


def random_forest_as_code(
    settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]
) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test checks it predicts as
    the step does. Helper names start with the model's own name, so they never replace a
    person's names."""
    train, model = inputs["train"], outputs["model"]
    classify = settings["task"] == "classification"
    forest = "RandomForestClassifier" if classify else "RandomForestRegressor"
    options = [
        f"n_estimators={settings.get('n_estimators', 200)!r}",
        f"random_state={settings.get('seed', 0)!r}",
        f"min_samples_leaf={settings.get('min_samples_leaf', 1)!r}",
    ]
    if settings.get("max_features") is not None:
        options.append(f"max_features={settings['max_features']!r}")
    features, numeric, other = f"{model}_features", f"{model}_numeric", f"{model}_categories"
    fit = f"{train}.select({features}), {train}[{settings['target']!r}].to_numpy()"
    code = (
        "import numpy as np\n"
        "from sklearn.compose import ColumnTransformer\n"
        f"from sklearn.ensemble import {forest}\n"
        "from sklearn.impute import SimpleImputer\n"
        "from sklearn.pipeline import Pipeline, make_pipeline\n"
        "from sklearn.preprocessing import FunctionTransformer, OneHotEncoder\n"
        "\n"
        f"{features} = {settings['features']!r}\n"
        f"{numeric} = [c for c in {features} if {train}.schema[c].is_numeric()]\n"
        f"{other} = [c for c in {features} if c not in {numeric}]\n"
        "\n"
        "# Numbers: gaps get the median. Text: gaps get the most frequent value, then one\n"
        "# column per category; a category seen only later is ignored. Trees need no scaling.\n"
        f"{model} = Pipeline([\n"
        '    ("preprocess", ColumnTransformer([\n'
        f'        ("numeric", SimpleImputer(strategy="median"), {numeric}),\n'
        '        ("categorical", make_pipeline(\n'
        "            FunctionTransformer(lambda x: np.asarray(x, dtype=object)),\n"
        '            SimpleImputer(missing_values=None, strategy="most_frequent"),\n'
        '            OneHotEncoder(handle_unknown="ignore"),\n'
        f"        ), {other}),\n"
        "    ])),\n"
        f'    ("forest", {forest}({", ".join(options)})),\n'
        "])\n"
    )
    costs = settings.get("costs")
    if not costs:
        return code + f"{model}.fit({fit})\n"
    return code + _costed_code(model, fit, costs, settings.get("seed", 0))


def _costed_code(model: str, fit: str, costs: dict[str, Any], seed: int) -> str:
    """The cut-off tuned for least cost on the model's own training rows (ADR-0053)."""
    positive, fn, fp = costs["positive"], costs["false_negative"], costs["false_positive"]
    return (
        "\n"
        "from sklearn.frozen import FrozenEstimator\n"
        "from sklearn.metrics import make_scorer\n"
        "from sklearn.model_selection import (\n"
        "    FixedThresholdClassifier, StratifiedKFold, TunedThresholdClassifierCV,\n"
        ")\n"
        "\n"
        "\n"
        f"def {model}_cost(y_true, y_pred, pos_label):\n"
        f'    """Mean cost per row: a missed {positive} costs {fn}, a false alarm {fp}."""\n'
        "    truth, said = np.asarray(y_true) == pos_label, np.asarray(y_pred) == pos_label\n"
        f"    return float(({fn!r} * (truth & ~said).sum() + {fp!r} * (~truth & said).sum()) / len(truth))\n"
        "\n"
        "\n"
        "# The cut-off is tuned on 3 folds of the training rows only.\n"
        f"{model}_tuned = TunedThresholdClassifierCV(\n"
        f"    {model},\n"
        f"    scoring=make_scorer({model}_cost, greater_is_better=False, pos_label={positive!r}),\n"
        f"    cv=StratifiedKFold(3, shuffle=True, random_state={seed!r}),\n"
        f").fit({fit})\n"
        f"{model} = FixedThresholdClassifier(\n"
        f"    FrozenEstimator({model}_tuned.estimator_),\n"
        f"    threshold=float({model}_tuned.best_threshold_),\n"
        f"    pos_label={positive!r},\n"
        f").fit({fit})\n"
    )
