import ast
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


@pytest.fixture
def clf_numbers(clf_frame: pl.DataFrame) -> pl.DataFrame:
    """clf_frame as its Clean steps leave it for a model (ADR-0056): x has no gap, c is 0/1."""
    return clf_frame.with_columns(pl.col("x").fill_null(0.0), c=(pl.col("c") == "a").cast(pl.Int8))


def _code_shape(code: str) -> str:
    """The code's syntax tree with every string emptied: only what runs, not what is quoted."""
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            node.value = ""
    return ast.dump(tree)


@pytest.fixture(scope="session")
def code_shape() -> Callable[[str], str]:
    """Plain code (ADR-0055) quotes dataset text (rule 7): with any text in it, its shape holds."""
    return _code_shape
