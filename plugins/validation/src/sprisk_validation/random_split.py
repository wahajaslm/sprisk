from typing import Any

import polars as pl
from sklearn.model_selection import train_test_split


def random_split(
    data: pl.DataFrame, test_fraction: float, seed: int, stratify: str | None = None
) -> dict[str, pl.DataFrame]:
    """Shuffle rows with a fixed seed, then hold out `test_fraction` of them for testing.

    With `stratify`, each class of that column keeps its share in both train and test."""
    if stratify is None:
        shuffled = data.sample(fraction=1.0, shuffle=True, seed=seed)
        n_test = round(shuffled.height * test_fraction)
        train, test = shuffled.slice(n_test), shuffled.head(n_test)
    else:
        classes = data[stratify]
        if classes.null_count():
            raise ValueError(
                f"{stratify} has {classes.null_count()} missing values; drop them first"
            )
        rows = list(range(data.height))
        train_rows, test_rows = train_test_split(
            rows, test_size=test_fraction, random_state=seed, stratify=classes.to_list()
        )
        train, test = data[sorted(train_rows)], data[sorted(test_rows)]
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}


def as_code(settings: dict[str, Any], inputs: dict[str, str], outputs: dict[str, str]) -> str:
    """This step as plain Python for a notebook cell (ADR-0055); a test runs it against the
    step. `inputs` and `outputs` name the variables each port goes by."""
    data, train, test = inputs["data"], outputs["train"], outputs["test"]
    fraction, seed, stratify = settings["test_fraction"], settings["seed"], settings.get("stratify")
    # Helper names come from the step's own outputs, so they never replace a person's names.
    if stratify is None:
        shuffled = f"{train}_shuffled"
        return (
            f"{shuffled} = {data}.sample(fraction=1.0, shuffle=True, seed={seed!r})\n"
            f"n_{test} = round({shuffled}.height * {fraction!r})\n"
            f"{train}, {test} = {shuffled}.slice(n_{test}), {shuffled}.head(n_{test})\n"
        )
    return (
        "from sklearn.model_selection import train_test_split\n"
        "\n"
        f"{train}_rows, {test}_rows = train_test_split(\n"
        f"    list(range({data}.height)),\n"
        f"    test_size={fraction!r},\n"
        f"    random_state={seed!r},\n"
        f"    stratify={data}[{stratify!r}].to_list(),\n"
        ")\n"
        f"{train}, {test} = {data}[sorted({train}_rows)], {data}[sorted({test}_rows)]\n"
    )
