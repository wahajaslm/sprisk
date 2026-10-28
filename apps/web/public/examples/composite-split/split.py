"""One composite Split node: its selection method and all available operators."""

from typing import Literal

import polars as pl
from sprisk import method, operator


SplitChoice = Literal["auto", "temporal", "group", "random"]


@operator(
    id="random_split",
    inputs=["data"],
    outputs=["train", "test"],
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
)
def random_split(
    data: pl.DataFrame,
    test_fraction: float = 0.20,
    seed: int = 42,
):
    rows = data.with_row_index("_sprisk_row")
    test = rows.sample(fraction=test_fraction, seed=seed, shuffle=True)
    train = rows.filter(~pl.col("_sprisk_row").is_in(test["_sprisk_row"]))
    return train.drop("_sprisk_row"), test.drop("_sprisk_row")


@operator(
    id="group_split",
    inputs=["data"],
    outputs=["train", "test"],
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
)
def group_split(
    data: pl.DataFrame,
    group_column: str,
    test_fraction: float = 0.20,
    seed: int = 42,
):
    test_groups = (
        data.select(group_column)
        .unique()
        .sample(fraction=test_fraction, seed=seed, shuffle=True)
        .get_column(group_column)
    )
    train = data.filter(~pl.col(group_column).is_in(test_groups))
    test = data.filter(pl.col(group_column).is_in(test_groups))
    return train, test


@operator(
    id="temporal_split",
    inputs=["data"],
    outputs=["train", "test"],
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
    },
)
def temporal_split(
    data: pl.DataFrame,
    time_column: str,
    test_fraction: float = 0.20,
):
    ordered = data.sort(time_column)
    cut = int(ordered.height * (1.0 - test_fraction))
    return ordered.head(cut), ordered.tail(ordered.height - cut)


@method(
    id="split",
    needs={
        "evidence": {
            "time_column": "data.structure.time_column",
            "group_column": "data.structure.group_column",
        },
    },
    options={
        "temporal": temporal_split,
        "group": group_split,
        "random": random_split,
    },
)
def split(
    data: pl.DataFrame,
    choice: SplitChoice = "auto",
    time_column: str | None = None,
    group_column: str | None = None,
    test_fraction: float = 0.20,
    seed: int = 42,
):
    if choice != "auto":
        return method.choose(choice, reason=f"User manually selected {choice}.")
    if time_column is not None:
        return method.choose(
            "temporal",
            reason=f"Use {time_column} so future observations cannot train the model.",
        )
    if group_column is not None:
        return method.choose(
            "group",
            reason=f"Keep every {group_column} value entirely inside train or test.",
        )
    return method.choose("random", reason="No temporal or entity boundary was found.")
