import polars as pl

from sprisk import operator
from validation.row_overlap import no_row_in_both
from validation.settings import Seed, TestFraction


@operator(role="split", folds="plain", role_default=True, promises=[no_row_in_both])
def random_split(
    data: pl.DataFrame, test_fraction: TestFraction = 0.2, seed: Seed = 42
) -> dict[str, pl.DataFrame]:
    """Shuffle rows with a fixed seed into train and test."""
    shuffled = data.sample(fraction=1.0, shuffle=True, seed=seed)
    n_test = round(shuffled.height * test_fraction)
    train, test = shuffled.slice(n_test), shuffled.head(n_test)
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}
