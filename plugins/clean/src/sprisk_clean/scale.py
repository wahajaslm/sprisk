from typing import Any

import polars as pl


def scale(
    train: pl.DataFrame, test: pl.DataFrame, columns: list[str], method: str
) -> dict[str, pl.DataFrame]:
    """Min-max, z-score or robust (median and IQR) with train statistics; test may fall
    outside [0, 1].

    NaN counts as missing, so it never sets the range."""
    nan_to_null = [pl.col(c).fill_nan(None) for c in columns if train.schema[c].is_float()]
    train, test = train.with_columns(nan_to_null), test.with_columns(nan_to_null)

    scaled = []
    for c in columns:
        low, high, mean, std, median, q25, q75 = train.select(
            low=pl.col(c).min(),
            high=pl.col(c).max(),
            mean=pl.col(c).mean(),
            std=pl.col(c).std(ddof=0),
            median=pl.col(c).median(),
            q25=pl.col(c).quantile(0.25, interpolation="linear"),
            q75=pl.col(c).quantile(0.75, interpolation="linear"),
        ).row(0)
        if method == "min_max":
            centre, spread = low, (None if low is None else high - low)
        elif method == "robust":
            centre, spread = median, (None if median is None else q75 - q25)
        else:
            centre, spread = mean, std
        if centre is None or not spread:
            raise ValueError(f"column {c} has no spread in train")
        scaled.append(((pl.col(c) - centre) / spread).alias(c))
    return {"train": train.with_columns(scaled), "test": test.with_columns(scaled)}


# Each method's centre and spread of a train column `{t}`, as the step takes them.
CENTRE_AND_SPREAD = {
    "min_max": ("{t}.min()", "{t}.max() - {t}.min()"),
    "z_score": ("{t}.mean()", "{t}.std(ddof=0)"),
    "robust": (
        "{t}.median()",
        '{t}.quantile(0.75, interpolation="linear") - {t}.quantile(0.25, interpolation="linear")',
    ),
}


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. Helper names start with the train output's name, so they never replace a person's."""
    train, test = inputs["train"], inputs["test"]
    train_out, test_out = outputs["train"], outputs["test"]
    columns = settings["columns"]
    nan, scaled = f"{train_out}_nan", f"{train_out}_scaled"
    method = settings["method"]
    if method not in CENTRE_AND_SPREAD:
        raise ValueError(f"scale has no method {method!r}")
    column = f"{train_out}[c]"
    centre, spread = (part.format(t=column) for part in CENTRE_AND_SPREAD[method])
    return (
        "import polars as pl\n"
        "\n"
        "# NaN counts as missing, so it never sets the scale.\n"
        f"{nan} = [pl.col(c).fill_nan(None) for c in {columns!r} if {train}.schema[c].is_float()]\n"
        f"{train_out}, {test_out} = {train}.with_columns({nan}), {test}.with_columns({nan})\n"
        "# Each column's centre and spread, from the training rows only.\n"
        f"{scaled} = [\n"
        f"    ((pl.col(c) - ({centre})) / ({spread})).alias(c)\n"
        f"    for c in {columns!r}\n"
        "]\n"
        f"{train_out}, {test_out} = "
        f"{train_out}.with_columns({scaled}), {test_out}.with_columns({scaled})\n"
    )
