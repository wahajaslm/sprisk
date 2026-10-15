from pathlib import Path

import polars as pl
from conftest import WriteParquet

from sprisk_profile.summarize import summarize


def test_one_row_per_column_with_null_counts(
    write_parquet: WriteParquet, clf_frame: pl.DataFrame, out_dir: Path
) -> None:
    [out] = summarize({}, {"data": write_parquet("d", clf_frame)}, out_dir)
    stats = pl.read_parquet(out.path)
    assert out.port == "profile"
    assert stats["column_name"].to_list() == ["x", "c", "y"]
    assert float(stats.filter(pl.col("column_name") == "x")["null_percentage"].item()) == 1.67
    assert stats.filter(pl.col("column_name") == "c")["count"].item() == 60
