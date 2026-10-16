"""A chart of a table, drawn with Plotly from only the numbers it needs (ADR-0023, ADR-0024):
bin counts, quartiles, bar values or a capped, seeded sample. Never the whole table."""

from typing import Any

import numpy as np
import plotly.graph_objects as go
import polars as pl

MAX_BARS = 50


def chart(
    data: pl.DataFrame,
    kind: str,
    x: str,
    y: str | None = None,
    bins: int = 20,
    max_points: int = 2000,
) -> go.Figure:
    """Draw a histogram, box, scatter, bar or line chart of `x` (and `y`)."""
    numbers = aggregate(data, kind, x, y, bins, max_points)
    title = f"{kind} of {x}" + (f" and {y}" if y else "")
    if kind == "histogram":
        b = numbers["bins"]
        trace: Any = go.Bar(
            x=[(i["lower"] + i["upper"]) / 2 for i in b],
            y=[i["count"] for i in b],
            width=[i["upper"] - i["lower"] for i in b],
        )
        axes = (x, "rows")
    elif kind == "box":
        g = numbers["groups"]
        trace = go.Box(
            x=[i["group"] for i in g],
            q1=[i.get("q1") for i in g],
            median=[i.get("median") for i in g],
            q3=[i.get("q3") for i in g],
            lowerfence=[i.get("min") for i in g],
            upperfence=[i.get("max") for i in g],
        )
        axes = (x if y else "", y or x)
    elif kind == "bar":
        trace = go.Bar(x=[i["x"] for i in numbers["bars"]], y=[i["value"] for i in numbers["bars"]])
        axes = (x, f"mean {y}" if y else "rows")
    else:
        points = numbers["points"]
        mode = "markers" if kind == "scatter" else "lines"
        trace = go.Scatter(
            x=[p[0] for p in points], y=[p[1] for p in points], mode=mode, marker={"size": 5}
        )
        axes = (x, y or "")
    if numbers.get("sampled"):
        title += f" (a fixed sample of {len(numbers['points'])} of {numbers['n_rows']} rows)"
    figure = go.Figure(trace, layout={"title": {"text": title}, "showlegend": False})
    figure.update_xaxes(title=axes[0])
    figure.update_yaxes(title=axes[1])
    return figure


def aggregate(
    data: pl.DataFrame,
    kind: str,
    x: str,
    y: str | None = None,
    bins: int = 20,
    max_points: int = 2000,
) -> dict[str, Any]:
    """The numbers a histogram, box, scatter, bar or line chart of `x` (and `y`) needs."""
    spec: dict[str, Any] = {"kind": kind, "x": x, "n_rows": data.height} | (
        {} if y is None else {"y": y}
    )
    if kind == "histogram":
        return spec | _histogram(data[x], bins)
    if kind == "box":
        return spec | _box(data, x, y)
    if kind == "bar":
        return spec | _bars(data, x, y)
    if y is None:
        raise ValueError(f"{kind} needs y")
    # Numbers stay numbers; dates and times become ISO text, so the report is plain JSON.
    pairs = pl.DataFrame([_axis(data[x]), _numeric(data[y])]).drop_nulls()
    if kind == "line":
        pairs = pairs.sort(x)
        step = max(1, -(-pairs.height // max_points))  # every step-th point keeps the line's shape
        return spec | {"points": _points(pairs.gather_every(step)), "sampled": step > 1}
    sample = (
        pairs.sample(n=min(max_points, pairs.height), seed=0)
        if pairs.height > max_points
        else pairs
    )
    return spec | {"points": _points(sample), "sampled": pairs.height > max_points}


def _points(pairs: pl.DataFrame) -> list[list[Any]]:
    return [list(row) for row in pairs.rows()]


def _axis(column: pl.Series) -> pl.Series:
    if column.dtype.is_temporal():
        return column.dt.to_string()
    return _numeric(column)


def _numeric(column: pl.Series) -> pl.Series:
    if not column.dtype.is_numeric():
        raise ValueError(f"{column.name} is not numeric ({column.dtype})")
    return column.cast(pl.Float64).fill_nan(None)


def _histogram(column: pl.Series, bins: int) -> dict[str, Any]:
    values = _numeric(column)
    present = values.drop_nulls().to_numpy()
    counts, edges = (
        np.histogram(present, bins=bins) if present.size else (np.array([]), np.array([]))
    )
    return {
        "bins": [
            {"lower": float(edges[i]), "upper": float(edges[i + 1]), "count": int(counts[i])}
            for i in range(len(counts))
        ],
        "missing": values.null_count(),
    }


def _box(data: pl.DataFrame, x: str, y: str | None) -> dict[str, Any]:
    value, by = (y, x) if y is not None else (x, None)
    values = _numeric(data[value]).alias("v")
    frame = pl.DataFrame([values]) if by is None else pl.DataFrame([data[by].alias("g"), values])
    stats = [
        pl.col("v").min().alias("min"),
        pl.col("v").quantile(0.25, "linear").alias("q1"),
        pl.col("v").median().alias("median"),
        pl.col("v").quantile(0.75, "linear").alias("q3"),
        pl.col("v").max().alias("max"),
        pl.col("v").count().alias("n"),
    ]
    if by is None:
        return {"groups": [_present({"group": value, **frame.select(stats).row(0, named=True)})]}
    grouped = frame.drop_nulls("v").group_by("g").agg(stats).sort("g").head(MAX_BARS)
    return {
        "groups": [
            _present({**r, "group": str(r["g"])}, drop="g") for r in grouped.iter_rows(named=True)
        ]
    }


def _present(row: dict[str, Any], drop: str = "") -> dict[str, Any]:
    """JSON with no nulls: a statistic with no values is left out, not written as null."""
    return {k: v for k, v in row.items() if v is not None and k != drop}


def _bars(data: pl.DataFrame, x: str, y: str | None) -> dict[str, Any]:
    if y is None:
        value = pl.len()
    else:
        _numeric(data[y])  # says why when y is text
        value = pl.col(y).cast(pl.Float64).fill_nan(None).mean()
    bars = data.group_by(x).agg(value.alias("value")).sort("value", descending=True).head(MAX_BARS)
    return {
        "bars": [
            {"x": str(r[x]), "value": r["value"]}
            for r in bars.iter_rows(named=True)
            if r["value"] is not None
        ]
    }
