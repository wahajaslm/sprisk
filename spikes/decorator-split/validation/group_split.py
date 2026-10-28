import plotly.graph_objects as go
import polars as pl
from sklearn.model_selection import GroupShuffleSplit

from sprisk import Verdict, operator, promise


@promise(id="no_group_overlap", text="No item has rows in both train and test.")
def no_group_overlap(train: pl.DataFrame, test: pl.DataFrame, group_column: str):
    train_items, test_items = set(train[group_column]), set(test[group_column])
    both = train_items & test_items
    evidence = {
        "overlapping_items": len(both),
        "examples": sorted(map(str, both))[:5],
        "train_items": len(train_items),
        "test_items": len(test_items),
    }
    if not train_items or not test_items:
        return Verdict("inconclusive", "One side has no items.", evidence)
    if both:
        return Verdict("fail", f"{len(both)} items have rows in both train and test.", evidence)
    return Verdict("pass", "No item is in both sides.", evidence)


def items_per_side(train: pl.DataFrame, test: pl.DataFrame, group_column: str) -> go.Figure:
    """Items in train and test"""
    items = [train[group_column].n_unique(), test[group_column].n_unique()]
    return go.Figure(go.Bar(x=["train", "test"], y=items))


@operator(
    id="group_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="group",
    columns={"group_column": "common.item_identity"},
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
    promises=[no_group_overlap],
)
def group_split(data: pl.DataFrame, group_column: str, test_fraction: float = 0.20, seed: int = 42):
    """Hold out complete entities so the same group never appears in train and test."""
    groups = data[group_column]
    if groups.null_count():
        raise ValueError(f"{group_column} has {groups.null_count()} missing values")
    if groups.n_unique() < 2:
        raise ValueError(f"{group_column} needs at least two distinct groups")
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_fraction, random_state=seed)
    train_rows, test_rows = next(splitter.split(range(data.height), groups=groups.to_list()))
    return data[sorted(train_rows)], data[sorted(test_rows)]
