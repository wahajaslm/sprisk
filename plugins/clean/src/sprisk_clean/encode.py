from typing import Any

import polars as pl


def encode(train: pl.DataFrame, test: pl.DataFrame, columns: list[str]) -> dict[str, pl.DataFrame]:
    """One column per category of each text column, named `<column>_<category>`, with the
    categories the train rows have (ADR-0056). A category seen only in test rows gets zeros."""
    for c in columns:
        if train[c].null_count() or test[c].null_count():
            raise ValueError(f"{c} has missing values; fill gaps before encoding")
    categories = {c: train[c].cast(pl.String).unique().sort().to_list() for c in columns}
    made = [f"{c}_{v}" for c, values in categories.items() for v in values]
    for name in made:
        if name in train.columns or name in test.columns:
            raise ValueError(f"{name} is already a column; rename it before encoding")
    one_hot = [
        (pl.col(c).cast(pl.String) == v).cast(pl.Int8).alias(f"{c}_{v}")
        for c, values in categories.items()
        for v in values
    ]
    return {
        "train": train.with_columns(one_hot).drop(columns),
        "test": test.with_columns(one_hot).drop(columns),
    }


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. Helper names start with the train output's name, so they never replace a person's."""
    train, test = inputs["train"], inputs["test"]
    train_out, test_out = outputs["train"], outputs["test"]
    categories, one_hot = f"{train_out}_categories", f"{train_out}_one_hot"
    return (
        "import polars as pl\n"
        "\n"
        "# Each text column's categories, as the training rows have them.\n"
        f"{categories} = {{\n"
        f"    c: {train}[c].cast(pl.String).unique().sort().to_list()\n"
        f"    for c in {settings['columns']!r}\n"
        "}\n"
        "# One 0/1 column per category; a category seen only in test rows gets zeros.\n"
        f"{one_hot} = [\n"
        '    (pl.col(c).cast(pl.String) == v).cast(pl.Int8).alias(f"{c}_{v}")\n'
        f"    for c, values in {categories}.items()\n"
        "    for v in values\n"
        "]\n"
        f"{train_out} = {train}.with_columns({one_hot}).drop(list({categories}))\n"
        f"{test_out} = {test}.with_columns({one_hot}).drop(list({categories}))\n"
    )
