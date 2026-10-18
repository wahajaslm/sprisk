"""Runs inside the session kernel (ADR-0036): tables and figures display as sprisk display items,
the same capped shape a code step writes, so the notebook shows them as the Inspector does.

Registered by type name, so no library is imported until the person's code imports it."""

from typing import Any

from sprisk_code.shown import MAX_FIGURE_BYTES, as_polars, table_page
from sprisk_workers.plain import figure_item

MIME = "application/vnd.sprisk.display+json"

# pandas 3 names its classes' module `pandas`; pandas 2 names where they are defined.
TABLES = [
    ("pandas", "DataFrame"),
    ("pandas", "Series"),
    ("pandas.core.frame", "DataFrame"),
    ("pandas.core.series", "Series"),
    ("polars.dataframe.frame", "DataFrame"),
    ("polars.series.series", "Series"),
]
FIGURES = [
    ("matplotlib.figure", "Figure"),
    ("seaborn.axisgrid", "FacetGrid"),
    ("seaborn.axisgrid", "PairGrid"),
    ("seaborn.axisgrid", "JointGrid"),
    ("plotly.graph_objs._figure", "Figure"),
    *[
        ("altair.vegalite.v5.api", name)
        for name in ("Chart", "LayerChart", "HConcatChart", "VConcatChart", "FacetChart")
    ],
]


def install(shell: Any) -> None:
    """`shell` is the kernel's IPython shell. Any: IPython ships no types for it."""
    _plotly_as_data()
    formatter = shell.display_formatter.mimebundle_formatter
    for module, name in TABLES:
        formatter.for_type_by_name(module, name, _table)
    for module, name in FIGURES:
        formatter.for_type_by_name(module, name, _figure)


def _table(value: object, include: object = None, exclude: object = None) -> dict[str, Any]:
    frame = as_polars(value)
    if frame is None:
        return {}
    return {MIME: {"kind": "table", "table": table_page(frame)}}


def _figure(value: object, include: object = None, exclude: object = None) -> dict[str, Any]:
    item = figure_item(value)
    if item is None:
        return {}
    if len(item["content"]) > MAX_FIGURE_BYTES:
        size = len(item["content"])
        return {MIME: {"kind": "text", "text": f"Figure not shown: {size} bytes."}}
    return {MIME: {"kind": "figure", "figure": item}}


def _plotly_as_data() -> None:
    """A Plotly figure displays itself (as a value or with `fig.show()`); make it send its
    figure as data, which the notebook draws, never HTML or a browser tab."""
    try:
        import plotly.io
    except ImportError:
        return
    plotly.io.renderers.default = "plotly_mimetype"
