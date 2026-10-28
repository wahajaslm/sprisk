import numpy as np
import plotly.graph_objects as go
import polars as pl

from sprisk_workers.authoring import Verdict, operator, promise, visualization


@promise(
    id="test_after_train",
    text="Every test row is later than the latest train row.",
    evidence="evaluation.time_order",
    fields={
        "not_later_test_rows": int,
        "latest_train": str,
        "earliest_test": str,
        "train_rows": int,
        "test_rows": int,
    },
    columns={"time_column": "common.event_time"},
    title="Time order check",
)
def test_after_train(train: pl.DataFrame, test: pl.DataFrame, time_column: str) -> Verdict:
    """Counts the test rows not later than the latest train row, the evidence that a temporal
    split trains only on the past.

    Args:
        time_column: The column that orders the rows.
    """
    # A row with no time has no order, so it is refused rather than counted either way.
    for table, side in ((train, "train"), (test, "test")):
        missing = table[time_column].null_count()
        if missing:
            raise ValueError(f"{missing} {side} rows have no {time_column}")
    latest = train[time_column].max()
    if latest is None or test.is_empty():
        raise ValueError(f"one side has no {time_column} values to order")
    early = test.filter(pl.col(time_column) <= latest).height
    evidence = {
        "not_later_test_rows": early,
        "latest_train": str(latest),
        "earliest_test": str(test[time_column].min()),
        "train_rows": train.height,
        "test_rows": test.height,
    }
    shown = evidence["latest_train"]
    if early:
        return Verdict("fail", f"{early} test rows are not later than {shown}.", evidence)
    return Verdict("pass", f"Every test row is later than {shown}, the latest train row.", evidence)


@operator(
    id="temporal_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="time",
    columns={"time_column": "common.event_time", "group_column": "common.item_identity"},
    tunables={"test_fraction": {"minimum": 0.05, "maximum": 0.5, "step": 0.05}},
    promises=[test_after_train],
)
def temporal_split(
    data: pl.DataFrame,
    time_column: str,
    test_fraction: float = 0.2,
    group_column: str | None = None,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Holds out the latest fifth of rows, by the time column, as the test set.

    Args:
        time_column: Rows are ordered by this column; the latest rows become the test set.
        test_fraction: Share of the latest rows held out for testing.
        group_column: Entity identifier. Train drops every entity that also appears in test,
            so none is on both sides.
    """
    times = data[time_column]
    if times.null_count():
        raise ValueError(f"{time_column} has {times.null_count()} missing values")
    cutoff = times.quantile(1 - test_fraction, interpolation="lower")
    is_test = pl.col(time_column) >= cutoff
    train, test = data.filter(~is_test), data.filter(is_test)
    # Train loses every row of an item that is also in test, so no item is on both sides.
    if group_column is not None:
        train = train.filter(~pl.col(group_column).is_in(test[group_column].implode()))
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return train, test


@visualization(title="Rows over time, with the cutoff")
def rows_over_time(train: pl.DataFrame, test: pl.DataFrame, time_column: str) -> go.Figure:
    # Both sides share 30 bins, so the chart stays one size however many rows there are.
    times = pl.concat([train[time_column], test[time_column]])
    edges = np.histogram_bin_edges(times.to_physical().to_numpy(), bins=30)
    starts = pl.Series(edges[:-1])
    if times.dtype.is_temporal():
        starts = starts.cast(pl.Int64).cast(times.dtype)
    figure = go.Figure()
    for name, side in (("train", train), ("test", test)):
        counts, _ = np.histogram(side[time_column].to_physical().to_numpy(), bins=edges)
        figure.add_bar(x=starts.to_list(), y=counts.tolist(), name=name)
    figure.add_vline(x=test[time_column].min())
    return figure.update_layout(yaxis_title="rows", barmode="stack")
