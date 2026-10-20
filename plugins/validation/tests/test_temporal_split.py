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


def test_a_group_column_keeps_test_entities_out_of_train() -> None:
    df = pl.DataFrame({"t": [1, 2, 3, 4, 5, 6], "user": ["a", "b", "c", "d", "a", "e"]})
    out = temporal_split(df, time_column="t", test_fraction=0.34, group_column="user")
    assert out["test"]["t"].to_list() == [4, 5, 6]
    # a is in test, so its earlier row leaves train.
    assert out["train"]["t"].to_list() == [2, 3]


def test_purging_every_train_row_is_an_error_not_an_empty_train() -> None:
    df = pl.DataFrame({"t": [1, 2, 3, 4], "user": ["a", "a", "a", "a"]})
    with pytest.raises(ValueError, match="train"):
        temporal_split(df, time_column="t", test_fraction=0.5, group_column="user")
