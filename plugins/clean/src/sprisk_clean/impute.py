from typing import Any

import polars as pl


def impute(
    train: pl.DataFrame,
    test: pl.DataFrame,
    columns: list[str],
    method: str,
    text_fill: dict[str, str] | None = None,
) -> dict[str, pl.DataFrame]:
    """Fill gaps with a statistic of the train rows, applied to train and test alike.

    The statistic comes from train only, so nothing about the test rows leaks into it.
    NaN counts as missing. Each text column's gaps get its `text_fill`: a category of their
    own, such as "missing", or "" for free text, where a gap is no words. A most-frequent fill
    would give a gap a value it never had."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    fills: dict[str, object] = {}
    for c in columns:
        dtype = train.schema[c]
        if dtype in (pl.String, pl.Categorical):
            fill = (text_fill or {}).get(c)
            if fill is None:
                raise ValueError(f"{c} is text: give it a text_fill for its gaps")
            # Empty text already means no words, as a gap filled with "" does.
            if fill and (
                (train[c].cast(pl.String) == fill).any() or (test[c].cast(pl.String) == fill).any()
            ):
                raise ValueError(f"{c} already has the value {fill!r}; pick another text_fill")
            fills[c] = fill
            continue
        if not dtype.is_numeric():
            raise ValueError(f"{c} is {dtype}: impute fills numbers and text only")
        if method == "zero":
            fills[c] = 0.0
            continue
        value = train[c].median() if method == "median" else train[c].mean()
        if value is None:
            raise ValueError(f"column {c} has no values in train")
        fills[c] = value

    filled = [pl.col(c).fill_null(v) for c, v in fills.items()]
    return {"train": train.with_columns(filled), "test": test.with_columns(filled)}


FILL_CODE = {
    "median": "{train}[c].median()",
    "mean": "{train}[c].mean()",
    "zero": "0.0",
}


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. Helper names start with the train output's name, so they never replace a person's."""
    train, test = inputs["train"], inputs["test"]
    train_out, test_out = outputs["train"], outputs["test"]
    columns, text_fill = settings["columns"], settings.get("text_fill", {})
    nan, text = f"{train_out}_nan", f"{train_out}_text_fill"
    fills, filled = f"{train_out}_fills", f"{train_out}_filled"
    method = settings["method"]
    if method not in FILL_CODE:
        raise ValueError(f"impute has no method {method!r}")
    number = FILL_CODE[method].format(train=train_out)
    return (
        "import polars as pl\n"
        "\n"
        "# NaN counts as missing.\n"
        f"{nan} = [pl.col(c).fill_nan(None) for c in {columns!r} if {train}.schema[c].is_float()]\n"
        f"{train_out}, {test_out} = {train}.with_columns({nan}), {test}.with_columns({nan})\n"
        "# Text gaps get a category of their own; number gaps a value from the train rows only.\n"
        f"{text} = {text_fill!r}\n"
        f"{fills} = {{\n"
        f"    c: {text}[c] if {train_out}.schema[c] in (pl.String, pl.Categorical)\n"
        f"    else {number}\n"
        f"    for c in {columns!r}\n"
        "}\n"
        f"{filled} = [pl.col(c).fill_null(v) for c, v in {fills}.items()]\n"
        f"{train_out}, {test_out} = "
        f"{train_out}.with_columns({filled}), {test_out}.with_columns({filled})\n"
    )
