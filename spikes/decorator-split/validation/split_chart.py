import plotly.graph_objects as go
import polars as pl

from sprisk import operator


@operator(role="chart", capability_class="analyzer")
def split_chart(train: pl.DataFrame, test: pl.DataFrame) -> dict[str, go.Figure]:
    """How many rows each side of the split holds."""
    total = train.height + test.height
    sides = ["train", "test"]
    rows = [train.height, test.height]
    figure = go.Figure(
        go.Bar(
            x=sides,
            y=rows,
            text=[f"{n:,} rows · {n / total:.0%}" for n in rows],
            textposition="outside",
        ),
        layout={"title": {"text": "Rows in train and test"}, "showlegend": False},
    )
    figure.update_yaxes(title="rows")
    return {"figure": figure}
