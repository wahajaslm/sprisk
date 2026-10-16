import polars as pl
import pytest

from sprisk_validation.temporal_split import temporal_split


def test_temporal_split_puts_all_train_strictly_before_test() -> None:
    df = pl.DataFrame({"t": [5, 1, 2, 2, 3, 3, 4, 4, 1, 5]})
    out = temporal_split(df, time_column="t", test_fraction=0.3)
    assert out["train"]["t"].max() < out["test"]["t"].min()  # type: ignore[operator]
    assert out["train"].height + out["test"].height == 10


@pytest.mark.parametrize(
    ("df", "error"),
    [
        (pl.DataFrame({"t": [1, None, 3, 4]}), ValueError),
        (pl.DataFrame({"other": [1, 2]}), pl.exceptions.ColumnNotFoundError),
        (pl.DataFrame({"t": [1, 1, 1, 1]}), ValueError),
    ],
)
def test_temporal_split_rejects_bad_data(df: pl.DataFrame, error: type[Exception]) -> None:
    with pytest.raises(error):
        temporal_split(df, time_column="t", test_fraction=0.5)
