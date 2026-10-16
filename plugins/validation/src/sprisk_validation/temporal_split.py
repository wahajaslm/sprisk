import polars as pl


def temporal_split(
    data: pl.DataFrame, time_column: str, test_fraction: float
) -> dict[str, pl.DataFrame]:
    """Train rows are strictly earlier than every test row; ties at the cutoff go to test."""
    times = data[time_column]
    if times.null_count():
        raise ValueError(f"{time_column} has {times.null_count()} missing values")
    cutoff = times.quantile(1 - test_fraction, interpolation="lower")
    is_test = pl.col(time_column) >= cutoff
    train, test = data.filter(~is_test), data.filter(is_test)
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}
