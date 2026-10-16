import polars as pl


def random_split(data: pl.DataFrame, test_fraction: float, seed: int) -> dict[str, pl.DataFrame]:
    """Shuffle rows with a fixed seed, then hold out `test_fraction` of them for testing."""
    shuffled = data.sample(fraction=1.0, shuffle=True, seed=seed)
    n_test = round(shuffled.height * test_fraction)
    train, test = shuffled.slice(n_test), shuffled.head(n_test)
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}
