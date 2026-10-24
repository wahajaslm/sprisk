import polars as pl
import pytest

from sprisk_profile.identity_frequency import identity_frequency

KIND = "data.identity_frequency"


def test_counts_items_their_records_and_the_rows_that_share_one() -> None:
    data = pl.DataFrame({"customer": ["a", "a", "a", "b", "c", "c"], "y": [1, 0, 1, 1, 0, 0]})
    found = identity_frequency(data, item_column="customer")

    assert found["evidence"] == {
        KIND: {
            "rows": 6,
            "items": 3,
            "repeated_items": 2,
            "rows_in_repeated": 5,
            "largest_item": 3,
            "missing": 0,
        }
    }


def test_a_missing_identifier_is_counted_as_missing_never_as_an_item() -> None:
    data = pl.DataFrame({"customer": ["a", None, None, "b"]})
    found = identity_frequency(data, item_column="customer")

    measured = found["evidence"][KIND]
    assert (measured["items"], measured["repeated_items"], measured["missing"]) == (2, 0, 2)


def test_the_chart_shows_how_many_items_have_each_number_of_records() -> None:
    data = pl.DataFrame({"customer": ["a", "a", "a", "b", "c", "c", "d"]})
    figure = identity_frequency(data, item_column="customer")["figures"]

    bars = {trace.name: dict(zip(trace.x, trace.y, strict=True)) for trace in figure.data}
    assert bars == {"One record": {"1": 2}, "Repeated": {"2": 1, "3": 1}}
    assert figure.layout.title.text == "Records per item (customer)"


def test_an_unknown_column_is_refused() -> None:
    with pytest.raises(ValueError, match="no column customer"):
        identity_frequency(pl.DataFrame({"id": [1]}), item_column="customer")
