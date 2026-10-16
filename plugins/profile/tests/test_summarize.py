import polars as pl

from sprisk_profile.summarize import summarize


def test_one_row_per_column_with_null_counts(clf_frame: pl.DataFrame) -> None:
    stats = summarize(clf_frame)
    assert stats["column_name"].to_list() == ["x", "c", "y"]
    assert float(stats.filter(pl.col("column_name") == "x")["null_percentage"].item()) == 1.67
    assert stats.filter(pl.col("column_name") == "c")["count"].item() == 60
