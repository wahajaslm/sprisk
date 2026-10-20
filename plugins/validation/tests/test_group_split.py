import polars as pl
import pytest

from sprisk_validation.group_split import group_split


def test_group_split_is_reproducible_and_keeps_entities_apart() -> None:
    data = pl.DataFrame({"order_id": [1, 1, 2, 2, 3, 3, 4, 4], "x": range(8)})
    first = group_split(data, "order_id", 0.5, 7)
    second = group_split(data, "order_id", 0.5, 7)
    assert first["test"].equals(second["test"])
    assert set(first["train"]["order_id"]).isdisjoint(first["test"]["order_id"])


@pytest.mark.parametrize(
    "data,error",
    [
        (pl.DataFrame({"g": [1, None, 2]}), "missing values"),
        (pl.DataFrame({"g": [1, 1]}), "at least two"),
    ],
)
def test_group_split_rejects_groups_it_cannot_separate(data: pl.DataFrame, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        group_split(data, "g", 0.5, 1)
