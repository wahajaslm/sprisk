import polars as pl

from sprisk import operator
from validation.row_overlap import no_row_in_both


@operator(
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="plain",
    role_default=True,
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
    promises=[no_row_in_both],
)
def random_split(
    data: pl.DataFrame, test_fraction: float = 0.2, seed: int = 42
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Shuffle rows with a fixed seed into train and test."""
    shuffled = data.sample(fraction=1.0, shuffle=True, seed=seed)
    n_test = round(shuffled.height * test_fraction)
    train, test = shuffled.slice(n_test), shuffled.head(n_test)
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return train, test
