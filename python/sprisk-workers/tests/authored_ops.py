"""A small operator written the ADR-0071 way, for the authoring tests."""

import polars as pl

from sprisk_workers.authoring import operator


@operator(
    id="every_nth",
    inputs=["data"],
    outputs=["kept", "dropped"],
    role="split",
    folds="plain",
    columns={"order_column": "common.event_time"},
    tunables={"every": {"minimum": 2, "maximum": 10, "step": 1}},
)
def every_nth(
    data: pl.DataFrame, order_column: str, every: int = 2, note: str | None = None
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Keep every nth row in time order; the others are dropped."""
    ordered = data.sort(order_column)
    picked = pl.int_range(pl.len()) % every == 0
    return ordered.filter(picked), ordered.filter(~picked)


# Operators the build must refuse, each for one reason.
LIMIT = 3


@operator(id="wrong_inputs", inputs=["rows"], outputs=["out"])
def wrong_inputs(data: pl.DataFrame) -> pl.DataFrame:
    """Declares an input it does not take."""
    return data


@operator(id="raw_bytes", inputs=["data"], outputs=["out"])
def raw_bytes(data: pl.DataFrame, raw: bytes = b"") -> pl.DataFrame:
    """Takes a setting with no JSON type."""
    return data


@operator(id="untyped", inputs=["data"], outputs=["out"])
def untyped(data: pl.DataFrame, n=1) -> pl.DataFrame:  # type: ignore[no-untyped-def]
    """Takes a setting with no type."""
    return data.head(n)


@operator(id="no_doc", inputs=["data"], outputs=["out"])
def no_doc(data: pl.DataFrame) -> pl.DataFrame:
    return data


@operator(id="uses_constant", inputs=["data"], outputs=["out"])
def uses_constant(data: pl.DataFrame) -> pl.DataFrame:
    """Reads a module constant its notebook cell would not have."""
    return data.head(LIMIT)


@operator(id="odd_tunable", inputs=["data"], outputs=["out"], tunables={"n": {"most": 3}})
def odd_tunable(data: pl.DataFrame, n: int = 1) -> pl.DataFrame:
    """Gives a setting a range key that does not exist."""
    return data.head(n)


@operator(id="ghost", inputs=["data"], outputs=["out"], columns={"ghost": "common.target"})
def ghost(data: pl.DataFrame) -> pl.DataFrame:
    """Names a column setting it does not take."""
    return data
