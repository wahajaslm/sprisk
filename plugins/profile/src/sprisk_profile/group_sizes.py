"""How many items have 1, 2, 3 … records: the one chart repeated-record evidence draws
(ADR-0065). Built from group sizes, never from rows."""

import plotly.graph_objects as go
import polars as pl

# Sizes from here up share one bar, so a table with a huge group still draws a small chart.
MAX_BARS = 20


def records_per_item(sizes: pl.Series, title: str) -> go.Figure:
    """One bar per group size: items seen once in one series, repeated items in another, so
    the repeated ones stand out."""
    capped = sizes.clip(upper_bound=MAX_BARS).alias("size")
    counts = capped.value_counts(sort=False).sort(capped.name)
    single = counts.filter(pl.col(capped.name) == 1)
    repeated = counts.filter(pl.col(capped.name) > 1)
    traces = [
        go.Bar(name=name, x=[label(s) for s in part[capped.name]], y=part["count"].to_list())
        for name, part in (("One record", single), ("Repeated", repeated))
        if part.height > 0
    ]
    figure = go.Figure(traces, layout={"title": {"text": title}, "barmode": "overlay"})
    figure.update_xaxes(title="records per item", type="category")
    figure.update_yaxes(title="items")
    return figure


def label(size: int) -> str:
    return f"{size}+" if size == MAX_BARS else str(size)
