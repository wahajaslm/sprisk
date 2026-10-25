import json

import polars as pl

from sprisk_contracts.generated.models import TableShift
from sprisk_profile.shift import table_shift


def shift_of(train: pl.DataFrame, test: pl.DataFrame) -> TableShift:
    return TableShift.model_validate_json(json.dumps(table_shift(train, test), allow_nan=False))


def test_a_column_drawn_alike_has_a_small_ks_and_a_shifted_one_a_large_ks() -> None:
    train = pl.DataFrame(
        {"same": [float(i % 50) for i in range(400)], "moved": [float(i % 50) for i in range(400)]}
    )
    test = pl.DataFrame(
        {
            "same": [float(i % 50) for i in range(100)],
            "moved": [float(i % 50) + 30 for i in range(100)],
        }
    )
    s = shift_of(train, test)
    ks = {c.column: c.ks for c in s.columns}
    assert ks["same"] < 0.05
    assert ks["moved"] > 0.5
    assert (s.rows, s.other_rows) == (400, 100)


def test_both_histograms_share_one_set_of_bins_and_count_every_value() -> None:
    train = pl.DataFrame({"x": [float(i) for i in range(100)]})
    test = pl.DataFrame({"x": [float(i) + 50 for i in range(40)]})
    x = shift_of(train, test).columns[0]
    assert len(x.counts) == len(x.other_counts) == 20
    assert sum(c.root for c in x.counts) == 100
    assert sum(c.root for c in x.other_counts) == 40
    assert (x.lower, x.upper) == (0.0, 99.0)


def test_only_numbers_both_tables_share_are_compared() -> None:
    train = pl.DataFrame({"x": [1.0, 2.0, 3.0], "t": ["a", "b", "c"], "only": [1.0, 2.0, 3.0]})
    test = pl.DataFrame({"x": [1.0, 2.0], "t": ["a", "b"]})
    assert [c.column for c in shift_of(train, test).columns] == ["x"]


def test_codes_and_identifiers_are_not_compared_only_measured_numbers() -> None:
    train = pl.DataFrame(
        {
            "code": [10, 40, 50] * 30,
            "row_id": list(range(90)),
            "weight": [float(i) * 1.5 for i in range(90)],
        }
    )
    test = pl.DataFrame(
        {
            "code": [10, 40] * 10,
            "row_id": list(range(90, 110)),
            "weight": [float(i) for i in range(20)],
        }
    )
    assert [c.column for c in shift_of(train, test).columns] == ["weight"]
