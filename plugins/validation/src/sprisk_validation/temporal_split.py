from typing import Any

import polars as pl


def temporal_split(
    data: pl.DataFrame, time_column: str, test_fraction: float, group_column: str | None = None
) -> dict[str, pl.DataFrame]:
    """Train rows are strictly earlier than every test row; ties at the cutoff go to test.

    With `group_column`, train also loses every row of an entity that appears in test, so no
    entity is seen on both sides (purging)."""
    times = data[time_column]
    if times.null_count():
        raise ValueError(f"{time_column} has {times.null_count()} missing values")
    cutoff = times.quantile(1 - test_fraction, interpolation="lower")
    is_test = pl.col(time_column) >= cutoff
    train, test = data.filter(~is_test), data.filter(is_test)
    if group_column is not None:
        train = train.filter(~pl.col(group_column).is_in(test[group_column].implode()))
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. Helper names start with the train output's name, so they never replace a person's."""
    data, train, test = inputs["data"], outputs["train"], outputs["test"]
    time, fraction = settings["time_column"], settings["test_fraction"]
    is_test = f"{train}_is_test"
    code = (
        "import polars as pl\n"
        "\n"
        "# The latest rows are the test rows; rows at the cut-off time go to test.\n"
        f"{is_test} = pl.col({time!r}) >= {data}[{time!r}].quantile(\n"
        f'    1 - {fraction!r}, interpolation="lower"\n'
        ")\n"
        f"{train}, {test} = {data}.filter(~{is_test}), {data}.filter({is_test})\n"
    )
    group = settings.get("group_column")
    if group is None:
        return code
    return code + (
        "# Train loses every entity that also appears in test.\n"
        f"{train} = {train}.filter(~pl.col({group!r}).is_in({test}[{group!r}].implode()))\n"
    )
