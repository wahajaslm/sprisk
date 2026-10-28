"""An operator file with its views (ADR-0071), for the authoring tests."""

import plotly.graph_objects as go
import polars as pl

from sprisk_workers.authoring import operator, visualization


@operator(
    id="halves",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="group",
    columns={"group_column": "common.item_identity"},
)
def halves(
    data: pl.DataFrame, group_column: str, share: float = 0.5
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Holds out the later rows for test.

    Args:
        group_column: The column that names each row's item.
        share: Share of rows kept for training.
    """
    cut = int(data.height * share)
    return data.head(cut), data.slice(cut)


def rows_per_side(train: pl.DataFrame, test: pl.DataFrame, share: float) -> go.Figure:
    """Rows on each side"""
    bar = go.Bar(x=["train", "test"], y=[train.height, test.height], name=f"{share:.0%} train")
    return go.Figure(bar)


def not_a_view(train: pl.DataFrame) -> int:
    return train.height


@visualization(title="Items on each side")
def items_per_side(train: pl.DataFrame, test: pl.DataFrame, group_column: str):  # type: ignore[no-untyped-def]
    items = [train[group_column].n_unique(), test[group_column].n_unique()]
    return go.Figure(go.Bar(x=["train", "test"], y=items))
