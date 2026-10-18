import json
import math
import subprocess
import sys
from pathlib import Path

import polars as pl
import pytest

from sprisk_contracts import DatasetProfile
from sprisk_contracts.generated.models import ColumnProfile
from sprisk_profile.dataset import MAX_BANDS, MAX_COLUMNS, MAX_CORRELATED, MIN_PAIRED, read_table
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
