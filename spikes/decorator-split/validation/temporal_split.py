import plotly.graph_objects as go
import polars as pl

from sprisk import operator, promise


@promise(id="test_after_train", text="Every test row is later than the latest train row.")
def test_after_train(train: pl.DataFrame, test: pl.DataFrame, time_column: str):
    latest = train[time_column].max()
    early = test.filter(pl.col(time_column) <= latest).height
    if early:
        return "fail", f"{early} test rows are not later than {latest}."
    return "pass", f"Every test row is later than {latest}."


def rows_over_time(train: pl.DataFrame, test: pl.DataFrame, time_column: str) -> go.Figure:
    """Rows over time, with the cutoff"""
    figure = go.Figure()
    for name, side in (("train", train), ("test", test)):
        counts = side.group_by(time_column).len().sort(time_column)
        figure.add_bar(x=counts[time_column], y=counts["len"], name=name)
    figure.add_vline(x=test[time_column].min())
    return figure


@operator(
    id="temporal_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="time",
    columns={"time_column": "common.event_time", "group_column": "common.item_identity"},
    tunables={"test_fraction": {"minimum": 0.05, "maximum": 0.40, "step": 0.05}},
    promises=[test_after_train],
)
def temporal_split(
    data: pl.DataFrame,
    time_column: str,
    test_fraction: float = 0.20,
    group_column: str | None = None,
):
    """Split by time. Every train row is strictly earlier than every test row."""
    if data[time_column].null_count():
        raise ValueError(f"{time_column} has {data[time_column].null_count()} missing values")
    cutoff = data[time_column].quantile(1 - test_fraction, interpolation="lower")
    train = data.filter(pl.col(time_column) < cutoff)
    test = data.filter(pl.col(time_column) >= cutoff)
    # Train drops every item that is also in test, so no item is on both sides.
    if group_column is not None:
        train = train.filter(~pl.col(group_column).is_in(test[group_column].implode()))
    return train, test
