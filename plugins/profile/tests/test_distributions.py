from pathlib import Path

import polars as pl
from conftest import WriteParquet

from sprisk_profile.distributions import BINS, distributions


def run(write_parquet: WriteParquet, df: pl.DataFrame, out_dir: Path) -> dict[str, pl.DataFrame]:
    outputs = distributions({}, {"data": write_parquet("d", df)}, out_dir)
    return {o.port: pl.read_parquet(o.path) for o in outputs}


def test_numeric_columns_get_equal_width_bins_that_count_every_value(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    hist = run(write_parquet, clf_frame, out_dir)["histograms"]
    assert hist["column_name"].unique().to_list() == ["x"], "text columns have no histogram"
    assert hist.height == BINS
    assert hist["count"].sum() == 59, "the missing value is not counted"
    assert (hist["bin_lower"][0], hist["bin_upper"][-1]) == (1.0, 59.0)
    assert hist["bin_upper"][:-1].to_list() == hist["bin_lower"][1:].to_list()


def test_constant_column_is_one_bin_and_empty_column_has_none(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    df = pl.DataFrame({"k": [3.0] * 5, "e": pl.Series([None] * 5, dtype=pl.Float64)})
    hist = run(write_parquet, df, out_dir)["histograms"]
    assert hist.rows() == [("k", 3.0, 3.0, 5)]


def test_correlation_lists_each_numeric_pair_once(
    write_parquet: WriteParquet, out_dir: Path
) -> None:
    df = pl.DataFrame(
        {"a": [1.0, 2.0, 3.0, 4.0], "b": [2, 4, 6, 8], "c": [4.0, 3.0, 2.0, 1.0], "t": list("wxyz")}
    )
    corr = run(write_parquet, df, out_dir)["correlation"]
    pairs = {
        (r["column_a"], r["column_b"]): round(r["pearson"], 6) for r in corr.iter_rows(named=True)
    }
    assert pairs == {("a", "b"): 1.0, ("a", "c"): -1.0, ("b", "c"): -1.0}


def test_column_names_are_quoted_not_executed(write_parquet: WriteParquet, out_dir: Path) -> None:
    name = 'x"); DROP TABLE t; --'
    hist = run(write_parquet, pl.DataFrame({name: [1.0, 2.0]}), out_dir)["histograms"]
    assert hist["column_name"].unique().to_list() == [name]
