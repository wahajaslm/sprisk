"""How far each class's share moved between the train and test rows. It reads the test labels,
so only the final score runs it (ADR-0064)."""

from typing import Any

import polars as pl

# Project convention, not a published bar: a few points of drift on a 20% test side.
MAX_GAP = 0.05


def class_shares(
    train: pl.DataFrame, test: pl.DataFrame, target: str, max_gap: float = MAX_GAP
) -> dict[str, Any]:
    """The largest difference in a class's share of rows between train and test, the class, and
    whether it drifted past `max_gap`. Rows with no label belong to no class."""
    shares = []
    for table, side in ((train, "train"), (test, "test")):
        if target not in table.columns:
            raise ValueError(f"the {side} rows have no column {target}")
        labels = table[target].drop_nulls()
        if labels.is_empty():
            raise ValueError(f"the {side} rows are empty, so no class share can be measured")
        shares.append(
            labels.value_counts(normalize=True, name="share").rename(
                {target: "class", "share": side}
            )
        )
    labelled = test[target].drop_nulls().len()
    joined = shares[0].join(shares[1], on="class", how="full", coalesce=True)
    gaps = joined.with_columns(
        gap=(pl.col("train").fill_null(0.0) - pl.col("test").fill_null(0.0)).abs()
    ).sort(["gap", "class"], descending=[True, False])
    gap = float(gaps["gap"][0])
    # One row more or less moves a share by 1/labelled: drift that small is rounding.
    return {
        "largest_gap": gap,
        "class": str(gaps["class"][0]),
        "drifted": gap > max(max_gap, 1 / labelled),
        "train_rows": train.height,
        "labelled_test_rows": labelled,
    }
