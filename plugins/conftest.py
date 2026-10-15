from collections.abc import Callable
from pathlib import Path

import polars as pl
import pytest

WriteParquet = Callable[[str, pl.DataFrame], Path]


@pytest.fixture
def out_dir(tmp_path: Path) -> Path:
    path = tmp_path / "staging"
    path.mkdir()
    return path


@pytest.fixture
def write_parquet(tmp_path: Path) -> WriteParquet:
    def write(name: str, df: pl.DataFrame) -> Path:
        path = tmp_path / f"{name}.parquet"
        df.write_parquet(path)
        return path

    return write


@pytest.fixture
def clf_frame() -> pl.DataFrame:
    """60 rows. x drives y; c is categorical noise; x has one missing value."""
    n = 60
    return pl.DataFrame(
        {
            "x": [None, *[float(i) for i in range(1, n)]],
            "c": ["a" if i % 2 else "b" for i in range(n)],
            "y": ["hi" if i >= n // 2 else "lo" for i in range(n)],
        }
    )
