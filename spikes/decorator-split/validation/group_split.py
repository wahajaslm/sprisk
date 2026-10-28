from typing import TypedDict

import polars as pl
from sklearn.model_selection import GroupShuffleSplit

from concepts import ItemIdentity
from sprisk import evidence, operator, promise
from validation.settings import Seed, TestFraction

# Enough ids for a person to look one up; the count says how many there are.
SHOWN = 20


class GroupOverlap(TypedDict):
    overlapping: int
    overlapping_groups: list[str]
    train_groups: int
    test_groups: int


@evidence(produces="evaluation.group_overlap", title="Group leakage check")
def group_overlap(
    train: pl.DataFrame, test: pl.DataFrame, group_column: ItemIdentity
) -> GroupOverlap:
    """Counts the groups with rows in both train and test."""
    learned = train[group_column].drop_nulls().unique()
    scored = test[group_column].drop_nulls().unique()
    both = learned.filter(learned.is_in(scored.implode())).sort()
    return {
        "overlapping": both.len(),
        "overlapping_groups": [str(g) for g in both.head(SHOWN).to_list()],
        "train_groups": learned.len(),
        "test_groups": scored.len(),
    }


@promise(needs=group_overlap)
def no_group_overlap(overlap: GroupOverlap) -> tuple[str, str]:
    """No item has rows in both train and test."""
    if overlap["train_groups"] == 0 or overlap["test_groups"] == 0:
        return "inconclusive", "One side has no groups."
    if overlap["overlapping"]:
        shown = ", ".join(overlap["overlapping_groups"][:5])
        return "fail", f"{overlap['overlapping']} items have rows in both train and test: {shown}"
    return "pass", (
        f"No item is in both sides ({overlap['train_groups']} train, "
        f"{overlap['test_groups']} test items)."
    )


@operator(role="split", folds="group", promises=[no_group_overlap])
def group_split(
    data: pl.DataFrame,
    group_column: ItemIdentity,
    test_fraction: TestFraction = 0.2,
    seed: Seed = 42,
) -> dict[str, pl.DataFrame]:
    """Hold out complete entities so the same group never appears in train and test."""
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
    return {"train": train, "test": test}
