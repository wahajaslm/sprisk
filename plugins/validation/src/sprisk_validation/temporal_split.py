import polars as pl


def temporal_split(
    data: pl.DataFrame, time_column: str, test_fraction: float, group_column: str | None = None
) -> dict[str, pl.DataFrame]:
    """Train rows are strictly earlier than every test row; ties at the cutoff go to test.

    With `group_column`, train also loses every row of an entity that appears in test, so no
    entity is seen on both sides (purging)."""
    times = data[time_column]
    if times.null_count():
        raise ValueError(f"{time_column} has {times.null_count()} missing values")
    cutoff = times.quantile(1 - test_fraction, interpolation="lower")
    is_test = pl.col(time_column) >= cutoff
    train, test = data.filter(~is_test), data.filter(is_test)
    if group_column is not None:
        train = train.filter(~pl.col(group_column).is_in(test[group_column].implode()))
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}
