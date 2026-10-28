"""What the target's values look like on the train rows (ADR-0063 slice 6): the evidence the
task type and class balance methods decide on. Train rows only, so the test rows stay
unread."""

from typing import Any

import polars as pl

KIND = "target.shape"


def target_shape(train: pl.DataFrame, target: str) -> dict[str, Any]:
    """How many distinct labels, whether they are numbers and whole numbers, and the share of
    the rarest one. Rows with no label belong to no class, so they are left out."""
    if target not in train.columns:
        raise ValueError(f"the train rows have no column {target}")
    labels = train[target].drop_nulls()
    if labels.is_empty():
        raise ValueError(f"the train rows hold no labels in {target}")
    numeric = labels.dtype.is_numeric()
    whole = numeric and bool((labels.cast(pl.Float64) % 1 == 0).all())
    shares = labels.value_counts(normalize=True, name="share")["share"]
    return {
        KIND: {
            "rows": train.height,
            "distinct": labels.n_unique(),
            "numeric": numeric,
            "whole_numbers": whole,
            "rarest_share": float(shares.min()),  # type: ignore[arg-type]
        },
        # On its own, so a person's model selection can give the shortlist the same count.
        "data.train_rows": {"rows": train.height},
    }
