"""What a split's outputs show, as evidence for the promises a split method makes (ADR-0063):
whether any group is on both sides, and how far each class's share moved."""

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
        "evidence": {
            "evaluation.group_overlap": {
                "overlapping": both.len(),
                "overlapping_groups": [str(g) for g in both.head(SHOWN).to_list()],
                "train_groups": learned.len(),
                "test_groups": scored.len(),
            }
        }
    }


def class_shares(train: pl.DataFrame, test: pl.DataFrame, target: str) -> dict[str, Any]:
    """The largest difference in a class's share of rows between train and test. Rows with no
    label belong to no class, so they are left out of the shares."""
    shares = []
    for table, side in ((train, "train"), (test, "test")):
        labels = _column(table, target, side).drop_nulls()
        if labels.is_empty():
            raise ValueError(f"the {side} rows are empty, so no class share can be measured")
        shares.append(
            labels.value_counts(normalize=True, name="share").rename(
                {target: "class", "share": side}
            )
        )
    joined = shares[0].join(shares[1], on="class", how="full", coalesce=True).fill_null(0.0)
    gap = (joined["train"] - joined["test"]).abs().max()
    return {
        "evidence": {
            "evaluation.class_shares": {
                "largest_gap": float(gap),  # type: ignore[arg-type]
                "train_rows": train.height,
                "test_rows": test.height,
            }
        }
    }
