import polars as pl

from sprisk_profile.distributions import BINS, distributions


def test_numeric_columns_get_equal_width_bins_that_count_every_value(
    clf_frame: pl.DataFrame,
) -> None:
    hist = distributions(clf_frame)["histograms"]
    assert hist["column_name"].unique().to_list() == ["x"], "text columns have no histogram"
    assert hist.height == BINS
    assert hist["count"].sum() == 59, "the missing value is not counted"
    assert (hist["bin_lower"][0], hist["bin_upper"][-1]) == (1.0, 59.0)
    assert hist["bin_upper"][:-1].to_list() == hist["bin_lower"][1:].to_list()


def test_constant_column_is_one_bin_and_empty_column_has_none() -> None:
    df = pl.DataFrame({"k": [3.0] * 5, "e": pl.Series([None] * 5, dtype=pl.Float64)})
    hist = distributions(df)["histograms"]
    assert hist.rows() == [("k", 3.0, 3.0, 5)]


def test_correlation_lists_each_numeric_pair_once() -> None:
    df = pl.DataFrame(
        {"a": [1.0, 2.0, 3.0, 4.0], "b": [2, 4, 6, 8], "c": [4.0, 3.0, 2.0, 1.0], "t": list("wxyz")}
    )
    corr = distributions(df)["correlation"]
    pairs = {
        (r["column_a"], r["column_b"]): round(r["pearson"], 6) for r in corr.iter_rows(named=True)
    }
    assert pairs == {("a", "b"): 1.0, ("a", "c"): -1.0, ("b", "c"): -1.0}


def test_column_names_are_quoted_not_executed() -> None:
    name = 'x"); DROP TABLE t; --'
    hist = distributions(pl.DataFrame({name: [1.0, 2.0]}))["histograms"]
    assert hist["column_name"].unique().to_list() == [name]


def test_draws_one_histogram_per_numeric_column(clf_frame: pl.DataFrame) -> None:
    [figure] = distributions(clf_frame)["figures"]
    assert [t.name for t in figure.data] == ["x"]
