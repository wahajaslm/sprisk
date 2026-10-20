import polars as pl
from sklearn.model_selection import GroupShuffleSplit


def group_split(
    data: pl.DataFrame, group_column: str, test_fraction: float, seed: int
) -> dict[str, pl.DataFrame]:
    """Hold complete groups out, with deterministic membership for a fixed seed."""
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
