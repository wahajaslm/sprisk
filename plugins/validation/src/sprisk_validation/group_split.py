import plotly.graph_objects as go
import polars as pl
from sklearn.model_selection import GroupShuffleSplit

from sprisk_workers.authoring import Verdict, operator, promise


@promise(
    id="no_group_overlap",
    text="No item has rows in both train and test.",
    evidence="evaluation.group_overlap",
    fields={
        "overlapping": int,
        "overlapping_groups": list[str],
        "train_groups": int,
        "test_groups": int,
    },
    columns={"group_column": "common.item_identity"},
    title="Group leakage check",
)
def no_group_overlap(train: pl.DataFrame, test: pl.DataFrame, group_column: str) -> Verdict:
    """Counts the groups with rows in both train and test, the evidence that a group split
    keeps each item on one side (ADR-0063).

    Args:
        group_column: The column that names each row's item.
    """
    learned = train[group_column].drop_nulls().unique()
    scored = test[group_column].drop_nulls().unique()
    both = learned.filter(learned.is_in(scored.implode())).sort()
    # Enough ids for a person to look one up; the count says how many there are.
    named = [str(g) for g in both.head(20).to_list()]
    evidence = {
        "overlapping": both.len(),
        "overlapping_groups": named,
        "train_groups": learned.len(),
        "test_groups": scored.len(),
    }
    if learned.is_empty() or scored.is_empty():
        return Verdict("inconclusive", "One side has no groups.", evidence)
    if both.len():
        shown = ", ".join(named[:5])
        return Verdict(
            "fail", f"{both.len()} items have rows in both train and test: {shown}", evidence
        )
    return Verdict(
        "pass",
        f"No item is in both sides ({learned.len()} train, {scored.len()} test items).",
        evidence,
    )


@operator(
    id="group_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    stage="split",
    folds="group",
    columns={"group_column": "common.item_identity"},
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.5, "step": 0.05},
        "seed": {"minimum": 0},
    },
    promises=[no_group_overlap],
)
def group_split(
    data: pl.DataFrame, group_column: str, test_fraction: float = 0.2, seed: int = 42
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Holds out about a fifth for test, keeping all rows of each item on one side.

    Args:
        group_column: Entity or group identifier kept wholly in one partition.
        test_fraction: Approximate share of groups held out for testing.
        seed: Fixes group selection so runs repeat.
    """
    groups = data[group_column]
    if groups.null_count():
        raise ValueError(
            f"{group_column} has {groups.null_count()} missing values; resolve them first"
        )
    if groups.n_unique() < 2:
        raise ValueError(f"{group_column} needs at least two distinct groups")
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_fraction, random_state=seed)
    train_rows, test_rows = next(splitter.split(range(data.height), groups=groups.to_list()))
    train, test = data[sorted(train_rows)], data[sorted(test_rows)]
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return train, test


def items_per_side(train: pl.DataFrame, test: pl.DataFrame, group_column: str) -> go.Figure:
    """Items on each side"""
    items = [train[group_column].n_unique(), test[group_column].n_unique()]
    return go.Figure(go.Bar(x=["train", "test"], y=items)).update_layout(yaxis_title="items")
