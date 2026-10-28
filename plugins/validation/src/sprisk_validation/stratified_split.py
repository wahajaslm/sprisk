import plotly.graph_objects as go
import polars as pl
from sklearn.model_selection import train_test_split

from sprisk_validation.random_split import no_row_in_both
from sprisk_workers.authoring import operator


@operator(
    id="stratified_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    stage="split",
    folds="plain",
    columns={"stratify": "common.target"},
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.5, "step": 0.05},
        "seed": {"minimum": 0},
    },
    # The class shares read the test labels, so they are reported with the final score.
    promises=[no_row_in_both],
)
def stratified_split(
    data: pl.DataFrame, stratify: str, test_fraction: float = 0.2, seed: int = 42
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Holds out a random fifth of rows for test, keeping each class's share on both sides.

    Args:
        stratify: Each class of this column keeps the same share in train and test.
        test_fraction: Share of rows held out for testing.
        seed: Fixes the shuffle so runs repeat.
    """
    classes = data[stratify]
    if classes.null_count():
        raise ValueError(f"{stratify} has {classes.null_count()} missing values; drop them first")
    train_rows, test_rows = train_test_split(
        list(range(data.height)),
        test_size=test_fraction,
        random_state=seed,
        stratify=classes.to_list(),
    )
    train, test = data[sorted(train_rows)], data[sorted(test_rows)]
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return train, test


def rows_per_side(train: pl.DataFrame, test: pl.DataFrame) -> go.Figure:
    """Rows on each side"""
    figure = go.Figure(go.Bar(x=["train", "test"], y=[train.height, test.height]))
    return figure.update_layout(yaxis_title="rows")
