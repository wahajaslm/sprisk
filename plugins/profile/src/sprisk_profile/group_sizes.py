"""How many items have 1, 2, 3 … records: the one chart repeated-record evidence draws
(ADR-0065). Built from group sizes, never from rows."""

import plotly.graph_objects as go
import polars as pl

# Sizes from here up share one bar, so a table with a huge group still draws a small chart.
MAX_BARS = 20


def records_per_item(sizes: pl.Series, title: str) -> go.Figure:
    """One bar per group size: repeated items in the first series, so they take the chart's
    first colour, and items seen once in another."""
    capped = sizes.clip(upper_bound=MAX_BARS).alias("size")
    counts = capped.value_counts(sort=False).sort(capped.name)
    single = counts.filter(pl.col(capped.name) == 1)
    repeated = counts.filter(pl.col(capped.name) > 1)
    traces = [
        go.Bar(name=name, x=[label(s) for s in part[capped.name]], y=part["count"].to_list())
        for name, part in (("Repeated", repeated), ("One record", single))
        if part.height > 0
    ]
    figure = go.Figure(traces, layout={"title": {"text": title}, "barmode": "overlay"})
    # Categories would follow the first series, putting 1 after the repeated sizes.
    order = [label(s) for s in counts["size"]]
    figure.update_xaxes(
        title="records per item", type="category", categoryorder="array", categoryarray=order
    )
    figure.update_yaxes(title="items")
    return figure


def label(size: int) -> str:
    return f"{size}+" if size == MAX_BARS else str(size)
