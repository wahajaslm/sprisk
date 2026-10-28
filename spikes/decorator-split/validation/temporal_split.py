from typing import TypedDict

import polars as pl

from concepts import EventTime, ItemIdentity
from sprisk import evidence, operator, promise
from validation.settings import TestFraction


class TimeOrder(TypedDict):
    not_later_test_rows: int
    latest_train: str
    earliest_test: str
    train_rows: int
    test_rows: int


@evidence(produces="evaluation.time_order", title="Time order check")
def time_order(train: pl.DataFrame, test: pl.DataFrame, time_column: EventTime) -> TimeOrder:
    """Counts the test rows that are not later than the latest train row."""
    for table, side in ((train, "train"), (test, "test")):
        missing = table[time_column].null_count()
        if missing:
            raise ValueError(f"{missing} {side} rows have no {time_column}")
    latest = train[time_column].max()
    if latest is None or test.is_empty():
        raise ValueError(f"one side has no {time_column} values to order")
    return {
        "not_later_test_rows": test.filter(pl.col(time_column) <= latest).height,
        "latest_train": str(latest),
        "earliest_test": str(test[time_column].min()),
        "train_rows": train.height,
        "test_rows": test.height,
    }


@promise(needs=time_order)
def test_after_train(order: TimeOrder) -> tuple[str, str]:
    """Every test row is later than the latest train row."""
    latest = order["latest_train"]
    if order["not_later_test_rows"]:
        return "fail", f"{order['not_later_test_rows']} test rows are not later than {latest}."
    return "pass", f"Every test row is later than {latest}, the latest train row."


@operator(role="split", folds="time", promises=[test_after_train])
def temporal_split(
    data: pl.DataFrame,
    time_column: EventTime,
    test_fraction: TestFraction = 0.2,
    group_column: ItemIdentity | None = None,
) -> dict[str, pl.DataFrame]:
    """Split by time. Every train row is strictly earlier than every test row."""
    times = data[time_column]
    if times.null_count():
        raise ValueError(f"{time_column} has {times.null_count()} missing values")
    cutoff = times.quantile(1 - test_fraction, interpolation="lower")
    is_test = pl.col(time_column) >= cutoff
    train, test = data.filter(~is_test), data.filter(is_test)
    # Purge: train loses every row of an item that is also in test.
    if group_column is not None:
        train = train.filter(~pl.col(group_column).is_in(test[group_column].implode()))
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}
