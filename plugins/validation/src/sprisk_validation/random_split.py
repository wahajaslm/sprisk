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
