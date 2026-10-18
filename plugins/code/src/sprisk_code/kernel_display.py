"""Runs inside the session kernel (ADR-0036): tables and figures display as sprisk display items,
the same capped shape a code step writes, so the notebook shows them as the Inspector does.

Registered by type name, so no library is imported until the person's code imports it."""

from typing import Any

from sprisk_code.shown import MAX_FIGURE_BYTES, as_polars, table_page
from sprisk_workers.plain import figure_item

MIME = "application/vnd.sprisk.display+json"
# A list or tuple of tables and figures (a step's figure output is a list): each one shown.
MANY = "application/vnd.sprisk.displays+json"

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
    for kind in (list, tuple):
        formatter.for_type(kind, _many)


def _table(value: object, include: object = None, exclude: object = None) -> dict[str, Any]:
    item = _table_item(value)
    return {MIME: item} if item else {}


def _figure(value: object, include: object = None, exclude: object = None) -> dict[str, Any]:
    item = _figure_item(value)
    return {MIME: item} if item else {}


def _many(
    value: list[Any] | tuple[Any, ...], include: object = None, exclude: object = None
) -> dict[str, Any]:
    """Shown item by item only when every item is a table or a figure; any other list keeps
    its plain text."""
    items = [_table_item(v) or _figure_item(v) for v in value]
    if not items or not all(items):
        return {}
    return {MANY: items}


def _table_item(value: object) -> dict[str, Any] | None:
    frame = as_polars(value)
    return None if frame is None else {"kind": "table", "table": table_page(frame)}


def _figure_item(value: object) -> dict[str, Any] | None:
    item = figure_item(value)
    if item is None:
        return None
    if len(item["content"]) > MAX_FIGURE_BYTES:
        return {"kind": "text", "text": f"Figure not shown: {len(item['content'])} bytes."}
    return {"kind": "figure", "figure": item}


def _plotly_as_data() -> None:
    """A Plotly figure displays itself (as a value or with `fig.show()`); make it send its
    figure as data, which the notebook draws, never HTML or a browser tab."""
    try:
        import plotly.io
    except ImportError:
        return
    plotly.io.renderers.default = "plotly_mimetype"
