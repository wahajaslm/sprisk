import polars as pl
from sklearn.model_selection import train_test_split

from concepts import Target
from sprisk import operator
from validation.row_overlap import no_row_in_both


@operator(
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="plain",
    tunables={
        "test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05},
        "seed": {"minimum": 0, "maximum": 10000},
    },
    promises=[no_row_in_both],
)
def stratified_split(
    data: pl.DataFrame, stratify: Target, test_fraction: float = 0.2, seed: int = 42
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Shuffle rows into train and test, keeping each class's share on both sides."""
    classes = data[stratify]
    if classes.null_count():
        raise ValueError(f"{stratify} has {classes.null_count()} missing values; drop them first")
    train_rows, test_rows = train_test_split(
        list(range(data.height)),
        test_size=test_fraction,
        random_state=seed,
        stratify=classes.to_list(),
    )
    train, test = data[sorted(train_rows)], data[sorted(test_rows)]
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return train, test
