import plotly.graph_objects as go
import polars as pl

from sprisk import operator, promise


@promise(id="no_row_in_both", text="No test row has the same features as a train row.")
def no_row_in_both(train: pl.DataFrame, test: pl.DataFrame):
    repeated = test.join(train.unique(), on=test.columns, how="semi", nulls_equal=True).height
    if repeated:
        return "fail", f"{repeated} test rows repeat a train row."
    return "pass", "No test row repeats a train row."


def rows_per_side(train: pl.DataFrame, test: pl.DataFrame) -> go.Figure:
    """Rows in train and test"""
    return go.Figure(go.Bar(x=["train", "test"], y=[train.height, test.height]))


@operator(
    id="random_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="plain",
    role_default=True,
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
    promises=[no_row_in_both],
)
def random_split(data: pl.DataFrame, test_fraction: float = 0.20, seed: int = 42):
    """Shuffle rows with a fixed seed into train and test."""
    shuffled = data.sample(fraction=1.0, shuffle=True, seed=seed)
    n_test = round(shuffled.height * test_fraction)
    return shuffled.slice(n_test), shuffled.head(n_test)
