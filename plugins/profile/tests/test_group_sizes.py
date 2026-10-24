import polars as pl

from sprisk_profile.group_sizes import MAX_BARS, records_per_item


def bars(sizes: list[int]) -> dict[str, dict[str, int]]:
    figure = records_per_item(pl.Series(sizes), "Records per item")
    return {trace.name: dict(zip(trace.x, trace.y, strict=True)) for trace in figure.data}


def test_items_with_one_record_and_repeated_items_are_two_series() -> None:
    assert bars([1, 1, 2, 4, 4]) == {"One record": {"1": 2}, "Repeated": {"2": 1, "4": 2}}


def test_sizes_past_the_last_bar_are_one_bar_so_the_chart_stays_small() -> None:
    found = bars([1, MAX_BARS, MAX_BARS + 5, MAX_BARS + 90])
    assert found["Repeated"] == {f"{MAX_BARS}+": 3}


def test_with_no_repeated_item_only_the_one_record_bar_is_drawn() -> None:
    assert bars([1, 1, 1]) == {"One record": {"1": 3}}
