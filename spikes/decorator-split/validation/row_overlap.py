"""Shared by the random and stratified splits: no test row repeats a train row."""

from typing import TypedDict

import polars as pl

from concepts import Target
from sprisk import evidence, promise


class RowOverlap(TypedDict):
    in_both: int
    train_rows: int
    test_rows: int


@evidence(
    produces="evaluation.row_overlap",
    title="Row leakage check",
    resources={"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600},
)
def row_overlap(train: pl.DataFrame, test: pl.DataFrame, target: Target) -> RowOverlap:
    """Counts the test rows whose features match a train row."""
    features = [c for c in test.columns if c != target]
    if not features:
        raise ValueError(f"the test rows have no feature columns beside {target} to compare")
    learned = train.select(features).unique()
    both = test.select(features).join(learned, on=features, how="semi", nulls_equal=True)
    return {"in_both": both.height, "train_rows": train.height, "test_rows": test.height}


@promise(needs=row_overlap)
def no_row_in_both(overlap: RowOverlap) -> tuple[str, str]:
    """No test row has the same features as a train row."""
    if overlap["in_both"]:
        return "fail", (
            f"{overlap['in_both']} test rows have the same features as a train row: the model "
            "is scored on rows it learned. Treat repeated rows as one item."
        )
    return "pass", f"No test row repeats a train row ({overlap['test_rows']} test rows)."
