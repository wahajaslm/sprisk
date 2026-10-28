"""A method, two operators and a promise written the ADR-0071 way, for the authoring tests."""

import polars as pl

from sprisk_workers.authoring import Verdict, method, operator, option, promise


@promise(
    id="no_shared_rows",
    text="No row is in both kept and dropped.",
    evidence="evaluation.shared_rows",
    fields={"shared": int, "examples": list[str]},
    columns={"label": "common.target"},
)
def no_shared_rows(train: pl.DataFrame, test: pl.DataFrame, label: str) -> Verdict:
    shared = train.join(test, on=train.columns, how="semi").height
    evidence = {"shared": shared, "examples": []}
    if shared:
        return Verdict("fail", f"{shared} rows are on both sides.", evidence)
    return Verdict("pass", "No row is on both sides.", evidence)


@operator(
    id="head_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="plain",
    role_default=True,
    tunables={"n": {"minimum": 1, "maximum": 100}},
    promises=[no_shared_rows],
)
def head_split(data: pl.DataFrame, n: int = 10) -> tuple[pl.DataFrame, pl.DataFrame]:
    """The first rows train; the rest test."""
    return data.head(n), data.tail(data.height - n)


@operator(
    id="time_split",
    inputs=["data"],
    outputs=["train", "test"],
    role="split",
    folds="time",
    columns={"time_column": "common.event_time"},
    promises=[no_shared_rows],
)
def time_split(
    data: pl.DataFrame, time_column: str, test_fraction: float = 0.2
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Earlier rows train; later rows test."""
    ordered = data.sort(time_column)
    cut = int(ordered.height * (1 - test_fraction))
    return ordered.head(cut), ordered.tail(ordered.height - cut)


@method(
    id="split_way",
    decides="split.way",
    activity="Fair evaluation",
    applies_when={"task": ["classification", "regression"]},
    decisions=["data.repeated_items"],
    columns={"event_time": "common.event_time"},
    options={
        "by_time": option(
            "Train on earlier rows, test on later ones",
            time_split,
            when="a time column is named",
            condition="time column named",
        ),
        "first_rows": option(
            "The first rows train",
            head_split,
            when="no time column is named",
            condition="¬ time column",
        ),
    },
    source="A test source.",
)
def split_way(task: str, event_time: object) -> object:
    """Split way

    How are rows divided?

    A split that ignores time trains on the future.
    """
    if event_time:
        return method.choose("by_time", reason="A time column orders the rows.")
    return method.choose("first_rows", reason="No time column.")
