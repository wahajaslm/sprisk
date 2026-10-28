import polars as pl
from sklearn.model_selection import train_test_split

from concepts import Target
from sprisk import operator
from validation.row_overlap import no_row_in_both
from validation.settings import Seed, TestFraction


@operator(role="split", folds="plain", promises=[no_row_in_both])
def stratified_split(
    data: pl.DataFrame, stratify: Target, test_fraction: TestFraction = 0.2, seed: Seed = 42
) -> dict[str, pl.DataFrame]:
    """Shuffle rows into train and test, keeping each class's share on both sides."""
    classes = data[stratify]
    if classes.null_count():
        raise ValueError(f"{stratify} has {classes.null_count()} missing values; drop them first")
    train_rows, test_rows = train_test_split(
        list(range(data.height)),
        test_size=test_fraction,
        random_state=seed,
        stratify=classes.to_list(),
    )
    train, test = data[sorted(train_rows)], data[sorted(test_rows)]
    if train.is_empty() or test.is_empty():
        raise ValueError(f"split gave {train.height} train and {test.height} test rows")
    return {"train": train, "test": test}
