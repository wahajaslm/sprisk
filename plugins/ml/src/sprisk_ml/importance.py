from typing import Any

import plotly.graph_objects as go
import polars as pl
from sklearn.inspection import permutation_importance
from sklearn.pipeline import Pipeline


def feature_importance(
    model: Pipeline, test: pl.DataFrame, target: str, seed: int = 0
) -> dict[str, Any]:
    """How much the model's score drops when one feature's values are shuffled in the test
    rows (permutation importance). Predictive importance for this model only, not causal;
    correlated features share or mask importance. A report about one fitted model; never use
    it to choose features or models, or the test set stops being held out."""
    features = list(model.feature_names_in_)
    if test[target].null_count():
        raise ValueError(f"{target} has {test[target].null_count()} missing values in test")
    x = test.select(features)

    def score(estimator: Pipeline, rows: Any, y: Any) -> float:
        # permutation_importance shuffles a plain array; give the model its named columns back.
        return float(estimator.score(pl.DataFrame(rows.tolist(), schema=x.schema, orient="row"), y))

    result = permutation_importance(
        model, x.to_numpy(), test[target].to_numpy(), scoring=score, n_repeats=10, random_state=seed
    )
    table = pl.DataFrame(
        {"feature": features, "importance": result.importances_mean, "std": result.importances_std}
    ).sort("importance", descending=True)
    bars = go.Bar(
        x=table["importance"].to_list(),
        y=table["feature"].to_list(),
        orientation="h",
        error_x={"array": table["std"].to_list()},
    )
    figure = go.Figure(
        bars, layout={"title": {"text": "Permutation importance (predictive, not causal)"}}
    )
    figure.update_yaxes(autorange="reversed")
    figure.update_xaxes(title="drop in score when shuffled")
    return {"importance": table, "figures": [figure]}
