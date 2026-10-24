"""What a split's outputs show, as evidence for the promises a split method makes (ADR-0063):
whether any group or any row is on both sides, and whether a test row comes before the train
rows. None reads a test label (ADR-0064). Each step has one output, so it returns the
EvidenceSet itself."""

from typing import Any

import polars as pl

# Enough ids for a person to look one up; the count says how many there are.
SHOWN = 20


def _column(table: pl.DataFrame, name: str, side: str) -> pl.Series:
    if name not in table.columns:
        raise ValueError(f"the {side} rows have no column {name}")
    return table[name]


def group_overlap(train: pl.DataFrame, test: pl.DataFrame, group_column: str) -> dict[str, Any]:
    """How many groups have rows in both train and test, and the first few of them."""
    learned = _column(train, group_column, "train").drop_nulls().unique()
    scored = _column(test, group_column, "test").drop_nulls().unique()
    both = learned.filter(learned.is_in(scored.implode())).sort()
    return {
        "evaluation.group_overlap": {
            "overlapping": both.len(),
            "overlapping_groups": [str(g) for g in both.head(SHOWN).to_list()],
            "train_groups": learned.len(),
            "test_groups": scored.len(),
        }
    }


def row_overlap(train: pl.DataFrame, test: pl.DataFrame, target: str) -> dict[str, Any]:
    """How many test rows have a train row with the same features. The worker drops the target
    before the step runs (its setting is marked excluded); a table that still has it is
    compared without it."""
    features = [c for c in test.columns if c != target]
    if not features:
        raise ValueError(f"the test rows have no feature columns beside {target} to compare")
    learned = train.select(features).unique()
    both = test.select(features).join(learned, on=features, how="semi", nulls_equal=True)
    return {
        "evaluation.row_overlap": {
            "in_both": both.height,
            "train_rows": train.height,
            "test_rows": test.height,
        }
    }


def time_order(train: pl.DataFrame, test: pl.DataFrame, time_column: str) -> dict[str, Any]:
    """How many test rows are not later than the latest train row. A row with no time has no
    order, so it is refused rather than counted either way."""
    for table, side in ((train, "train"), (test, "test")):
        missing = _column(table, time_column, side).null_count()
        if missing:
            raise ValueError(f"{missing} {side} rows have no {time_column}")
    latest = train[time_column].max()
    if latest is None or test.is_empty():
        raise ValueError(f"one side has no {time_column} values to order")
    return {
        "evaluation.time_order": {
            "not_later_test_rows": test.filter(pl.col(time_column) <= latest).height,
            "latest_train": str(latest),
            "earliest_test": str(test[time_column].min()),
            "train_rows": train.height,
            "test_rows": test.height,
        }
    }
