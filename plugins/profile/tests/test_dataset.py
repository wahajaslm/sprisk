import json
import math
import subprocess
import sys
from pathlib import Path

import polars as pl
import pytest

from sprisk_contracts import DatasetProfile
from sprisk_contracts.generated.models import ColumnProfile
from sprisk_profile.dataset import (
    MAX_BANDS,
    MAX_COLUMNS,
    MAX_CORRELATED,
    MAX_RARE_VALUES,
    MIN_PAIRED,
    read_table,
)
from sprisk_profile.dataset import profile as raw_profile


def profile_of(data: pl.DataFrame, **sizes: int) -> DatasetProfile:
    """As Rust reads it: the JSON checked against the contract."""
    return DatasetProfile.model_validate_json(
        json.dumps(raw_profile(data, **sizes), allow_nan=False)
    )


def profile(data: pl.DataFrame) -> DatasetProfile:
    return profile_of(data)


def frame() -> pl.DataFrame:
    n = 100
    return pl.DataFrame(
        {
            "x": [float(i) for i in range(n)],
            "y": [2.0 * i + 1 for i in range(n)],
            "k": [5.0] * n,
            "g": ["a" if i % 3 else "b" for i in range(n)],
            "holes": [None if i < 50 else float(i) for i in range(n)],
            "empty": pl.Series([None] * n, dtype=pl.Float64),
        }
    )


def column(p: DatasetProfile, name: str) -> ColumnProfile:
    return next(c for c in p.columns if c.name == name)


def bar_labels(p: DatasetProfile, name: str) -> list[str]:
    histogram = column(p, name).histogram
    assert histogram is not None, name
    return [b.label for b in histogram.bars]


def test_counts_rows_columns_missing_and_distinct() -> None:
    p = profile(frame())
    assert (p.total_rows, p.total_columns) == (100, 6)
    assert [c.name for c in p.columns] == ["x", "y", "k", "g", "holes", "empty"]
    assert (column(p, "holes").missing, column(p, "holes").distinct) == (50, 50)
    assert (column(p, "g").missing, column(p, "g").distinct) == (0, 2)


def test_numeric_columns_get_bins_and_others_their_top_values() -> None:
    p = profile(frame())
    x = column(p, "x").histogram
    assert x is not None and x.kind.value == "bins"
    assert len(x.bars) == 20 and sum(b.count for b in x.bars) == 100
    g = column(p, "g").histogram
    assert g is not None and g.kind.value == "top_values"
    assert [(b.label, b.count) for b in g.bars] == [("a", 66), ("b", 34)]
    assert column(p, "empty").histogram is None


def test_top_values_keep_the_ten_most_common() -> None:
    p = profile(pl.DataFrame({"t": [f"v{i % 25}" for i in range(250)]}))
    assert len(bar_labels(p, "t")) == 10


def test_missing_map_has_bounded_bands_in_row_order() -> None:
    p = profile(frame())
    holes = column(p, "holes").missing_by_band
    assert len(holes) <= MAX_BANDS
    assert holes[0] == 1.0 and holes[-1] == 0.0
    assert column(p, "x").missing_by_band == [0.0] * len(holes)
    assert p.band_rows * (len(holes) - 1) < 100 <= p.band_rows * len(holes)


def pairs(p: DatasetProfile) -> dict[tuple[str, str], tuple[float, int]]:
    return {(q.column_a, q.column_b): (q.pearson, q.rows) for q in p.correlation.pairs}


def test_correlation_covers_numeric_columns_that_vary_with_the_rows_each_pair_uses() -> None:
    p = profile(frame())
    assert p.correlation.columns == ["x", "y", "holes"], "constant and empty columns are left out"
    found = pairs(p)
    assert found["x", "y"][0] == pytest.approx(1.0)
    assert found["x", "y"][1] == 100
    assert found["x", "holes"][1] == 50, "only rows where both are present"
    assert len(found) == 3, "each pair once"


def test_a_pair_constant_on_its_shared_rows_is_left_out_not_a_crash() -> None:
    a = [float(i) for i in range(20)] + [None] * 20
    b = [5.0] * 20 + [float(i) for i in range(20)]
    p = profile(pl.DataFrame({"a": a, "b": b}))
    assert p.correlation.columns == ["a", "b"]
    assert pairs(p) == {}


def test_a_pair_with_too_few_shared_rows_is_left_out() -> None:
    n = MIN_PAIRED - 1
    a = [float(i) for i in range(n)] + [None] * 30
    b = [float(i) for i in range(n)] + [float(i) for i in range(30)]
    assert pairs(profile(pl.DataFrame({"a": a, "b": b}))) == {}


def test_dataset_text_cannot_collide_with_internal_names() -> None:
    p = profile(
        pl.DataFrame({"count": ["a", "b", "a"], "value": ["x", "y", "y"], "n": ["1", "1", "2"]})
    )
    assert bar_labels(p, "count") == ["a", "b"]


def test_wide_tables_profile_their_first_columns() -> None:
    wide = pl.DataFrame({f"c{i}": [1.0, 2.0] for i in range(MAX_COLUMNS + 5)})
    p = profile(wide)
    assert (len(p.columns), p.total_columns) == (MAX_COLUMNS, MAX_COLUMNS + 5)


def test_long_tables_are_read_up_to_a_row_cap_and_say_their_true_size(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    pl.DataFrame({"a": list(range(25)), "b": list(range(25))}).write_parquet(path)
    data, rows, columns = read_table(str(path), max_rows=10, max_columns=1)
    assert (data.height, data.columns, rows, columns) == (10, ["a"], 25, 2)


def test_a_capped_table_says_how_many_rows_the_profile_covers() -> None:
    p = profile_of(pl.DataFrame({"a": [1.0, 2.0]}), total_rows=50, total_columns=3)
    assert (p.total_rows, p.total_columns, p.profiled_rows) == (50, 3, 2)


def test_a_column_name_that_looks_like_a_pattern_is_just_a_name() -> None:
    p = profile(pl.DataFrame({"^.*$": [1.0, float("nan")], "b": [2.0, 3.0]}))
    assert [(c.name, c.missing) for c in p.columns] == [("^.*$", 1), ("b", 0)]


def test_nan_and_infinity_count_as_missing_so_the_profile_stays_valid_json() -> None:
    p = profile(
        pl.DataFrame({"a": [1.0, float("nan"), 3.0, float("inf")], "b": [1.0, 2.0, 3.0, 4.0]})
    )
    assert column(p, "a").missing == 2
    text = p.model_dump_json()
    assert "NaN" not in text and "Infinity" not in text
    assert all(math.isfinite(q.pearson) for q in p.correlation.pairs)


def test_correlation_is_capped() -> None:
    wide = pl.DataFrame({f"c{i}": [float(j * (i + 1) % 7) for j in range(20)] for i in range(40)})
    assert len(profile(wide).correlation.columns) == MAX_CORRELATED


def test_empty_table() -> None:
    p = profile(pl.DataFrame({"a": pl.Series([], dtype=pl.Float64)}))
    assert (p.total_rows, p.band_rows) == (0, 0)
    assert column(p, "a").missing_by_band == []


def test_command_profiles_a_parquet_file_named_on_stdin(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    frame().write_parquet(path)
    done = subprocess.run(
        [sys.executable, "-m", "sprisk_profile.dataset"],
        input=str(path),
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    assert DatasetProfile.model_validate_json(done.stdout).total_rows == 100
    json.loads(done.stdout)


def test_command_fails_loudly_on_a_file_it_cannot_read(tmp_path: Path) -> None:
    path = tmp_path / "not.parquet"
    path.write_text("x,y\n1,2\n")
    done = subprocess.run(
        [sys.executable, "-m", "sprisk_profile.dataset"],
        input=str(path),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert done.returncode != 0
    assert "not.parquet" in done.stderr


def test_numeric_columns_report_skew_kurtosis_and_outlier_share() -> None:
    values = [float(v) for v in range(1, 20)] + [1000.0]
    column = profile(pl.DataFrame({"x": values, "label": ["a"] * 20})).columns[0]
    assert column.skewness is not None and column.skewness > 3
    assert column.kurtosis is not None and column.kurtosis > 3
    assert column.outlier_share == pytest.approx(1 / 20)
    assert column.iqr == pytest.approx(9.5)


def test_a_mostly_equal_column_reports_a_zero_iqr() -> None:
    flag = [0.0] * 18 + [1.0] * 2
    column = profile(pl.DataFrame({"flag": flag, "label": ["a"] * 20})).columns[0]
    assert column.iqr == 0


def test_shape_is_left_out_where_it_means_nothing() -> None:
    data = pl.DataFrame({"flat": [2.0] * 20, "label": ["a", "b"] * 10})
    flat, label = profile(data).columns
    assert flat.skewness is None and flat.outlier_share is None
    assert label.kurtosis is None


def test_rows_equal_to_an_earlier_row_are_counted_as_duplicates() -> None:
    p = profile(pl.DataFrame({"a": [1, 1, 2, 1, 2], "b": ["x", "x", "y", "x", "z"]}))
    assert p.duplicate_rows == 2


def unconverted(p: DatasetProfile, name: str) -> list[str]:
    values = column(p, name).unconverted
    assert values is not None, name
    return [v.root for v in values]


def test_duplicates_are_counted_as_drop_duplicates_compares_rows() -> None:
    nan, gap = float("nan"), None
    p = profile(pl.DataFrame({"a": [nan, gap, nan]}))
    assert p.duplicate_rows == 1


def test_a_table_wider_than_the_profile_gives_no_duplicate_count() -> None:
    data = pl.DataFrame({f"c{i}": [1, 1] for i in range(MAX_COLUMNS)})
    assert profile_of(data).duplicate_rows == 1
    assert profile_of(data, total_columns=MAX_COLUMNS + 1).duplicate_rows is None
    assert profile_of(data, total_rows=3).duplicate_rows is None


def test_a_column_with_few_values_gives_its_rarest_values_share() -> None:
    p = profile(pl.DataFrame({"y": [0, 0, 0, 1], "c": ["a", "b", "b", None], "x": list(range(4))}))
    assert column(p, "y").rarest_share == pytest.approx(0.25)
    assert column(p, "c").rarest_share == pytest.approx(1 / 3)
    many = profile(pl.DataFrame({"x": list(range(MAX_RARE_VALUES + 1))}))
    assert column(many, "x").rarest_share is None


def test_a_text_column_says_what_share_reads_as_numbers_and_which_values_do_not() -> None:
    p = profile(pl.DataFrame({"age": ["31", "?", "n/a", "?", "4.5", "NaN", None]}))
    age = column(p, "age")
    assert age.numeric_share == pytest.approx(2 / 6)
    assert unconverted(p, "age") == ["?", "NaN", "n/a"]


def test_only_text_columns_with_some_numbers_list_unconverted_values() -> None:
    p = profile(pl.DataFrame({"n": [1.0, 2.0], "all": ["1", "2"], "words": ["a", "b"]}))
    assert (column(p, "n").numeric_share, column(p, "n").unconverted) == (None, None)
    assert (column(p, "all").numeric_share, column(p, "all").unconverted) == (1.0, None)
    assert (column(p, "words").numeric_share, column(p, "words").unconverted) == (0.0, None)


def test_a_text_column_counts_numbers_with_a_leading_zero_like_a_code() -> None:
    p = profile(pl.DataFrame({"zip": ["01234", "75001"], "n": ["0", "0.5"], "w": ["a", "b"]}))
    assert column(p, "zip").leading_zero_values == 1
    assert column(p, "n").leading_zero_values == 0
    assert column(p, "w").leading_zero_values == 0


def test_padded_numbers_read_as_numbers_and_padded_markers_keep_their_spaces() -> None:
    p = profile(pl.DataFrame({"age": [" 12", "13 ", " ?", " 012"]}))
    assert column(p, "age").numeric_share == pytest.approx(3 / 4)
    assert column(p, "age").leading_zero_values == 1
    assert unconverted(p, "age") == [" ?"]


def test_unconverted_values_are_bounded_and_cut() -> None:
    long = "x" * 100
    p = profile(pl.DataFrame({"t": ["1"] + [f"v{i}" for i in range(20)] + [long, long]}))
    values = unconverted(p, "t")
    assert len(values) == 10 and values[0] == "x" * 60
