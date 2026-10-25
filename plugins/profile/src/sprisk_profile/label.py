"""How the columns of a table relate to its label, for the Datasets Explore page (ADR-0065).

Of every row, held-out rows included: the page is for looking, never for choosing features or
models (rule 8). Columns come in as series, never by `pl.col(name)`: a dataset's column name is
untrusted (rule 7) and could read as a pattern there.
"""

from typing import Any

import numpy as np
import polars as pl
from sklearn.feature_selection import f_classif

# More labels than this and the label is not a class: no relation is drawn.
MAX_CLASSES = 20
# Classes whose histograms are split apart; more would be unreadable.
SPLIT_CLASSES = 6
# Values a category may have to show the label's share in each, and categories shown.
MAX_GROUPS = 20
GROUP_COLUMNS = 6
MAX_LABEL = 60


def label_profile(
    data: pl.DataFrame, columns: list[dict[str, Any]], target: str
) -> dict[str, Any] | None:
    """The label's classes, each measured number's strength with it and its bins split by
    class, and the first class's share in each value of a category. None without the column."""
    if target not in data.columns:
        return None
    labelled = data.filter(data[target].is_not_null())
    y = labelled[target].cast(pl.String).rename("label")
    counts = y.value_counts(name="n").sort(["n", "label"], descending=[True, False])
    classes = [
        {"label": v[:MAX_LABEL], "count": n} for v, n in counts.head(MAX_CLASSES).iter_rows()
    ]
    other = y.len() - sum(c["count"] for c in classes)
    profile: dict[str, Any] = {
        "target": target,
        "classes": classes,
        "other": other,
        "numbers": [],
        "groups": [],
    }
    if other > 0 or len(classes) < 2:
        return profile
    names = [str(v) for v in counts["label"]]
    for column in columns:
        name = column["name"]
        if name == target:
            continue
        if column["role"] == "number" and (number := _number(labelled[name], y, names, column)):
            profile["numbers"].append(number)
        grouping = column["role"] in ("category", "boolean")
        if (
            grouping
            and len(profile["groups"]) < GROUP_COLUMNS
            and (group := _group(labelled[name], y, names[0]))
        ):
            profile["groups"].append(group)
    return profile


def _number(
    x: pl.Series, y: pl.Series, names: list[str], column: dict[str, Any]
) -> dict[str, Any] | None:
    both = pl.DataFrame({"x": x.cast(pl.Float64), "y": y}).drop_nulls()
    k = both["y"].n_unique()
    if both.height <= k or k < 2 or both["x"].n_unique() < 2:
        return None
    values = both["x"].to_numpy()
    labels = both["y"].to_numpy()
    # No spread inside each class makes F infinite: the number separates the classes fully.
    with np.errstate(divide="ignore", invalid="ignore"):
        f, _ = f_classif(values.reshape(-1, 1), labels)
    if np.isnan(f[0]):
        return None
    # The correlation ratio from the one-way F: eta^2 = F(k-1) / (F(k-1) + n-k). For two classes
    # it is |point-biserial r|; the sign says whether the first class sits higher.
    between = f[0] * (k - 1)
    eta = 1.0 if np.isinf(between) else float(np.sqrt(between / (between + both.height - k)))
    if k == 2:
        first = values[labels == names[0]].mean()
        rest = values[labels != names[0]].mean()
        eta = eta if first >= rest else -eta
    number: dict[str, Any] = {"column": column["name"], "r": eta}
    bars = (column.get("histogram") or {}).get("bars", [])
    if len(names) <= SPLIT_CLASSES and bars and all("lower" in b for b in bars):
        edges = [b["lower"] for b in bars] + [bars[-1]["upper"]]
        number["by_class"] = [_bins(values[labels == name], name, edges) for name in names]
    return number


def _bins(values: np.ndarray, name: str, edges: list[float]) -> dict[str, Any]:
    split: dict[str, Any] = {"label": name[:MAX_LABEL]}
    if edges[0] == edges[-1]:
        split["counts"] = [int(values.size)]
    else:
        # DuckDB's own binning (distributions._histogram), so the classes add up to the bars;
        # numpy.histogram compares with the edges and can put a value on an edge one bin over.
        bins = len(edges) - 1
        width = (edges[-1] - edges[0]) / bins
        at = np.minimum(np.floor((values - edges[0]) / width), bins - 1).astype(int)
        split["counts"] = [int(n) for n in np.bincount(at, minlength=bins)]
    if values.size:
        q = np.quantile(values, [0, 0.25, 0.5, 0.75, 1])
        split["quartiles"] = dict(
            zip(("min", "q1", "median", "q3", "max"), (float(v) for v in q), strict=True)
        )
    return split


def _group(g: pl.Series, y: pl.Series, first: str) -> dict[str, Any] | None:
    both = pl.DataFrame({"g": g.cast(pl.String), "hit": y == first}).drop_nulls()
    if not 2 <= both["g"].n_unique() <= MAX_GROUPS:
        return None
    shares = (
        both.group_by("g")
        .agg(pl.len().alias("rows"), pl.col("hit").mean().alias("share"))
        .sort("g")
    )
    values = [
        {"label": v[:MAX_LABEL], "rows": n, "share": float(s)} for v, n, s in shares.iter_rows()
    ]
    return {"column": g.name, "values": values}
