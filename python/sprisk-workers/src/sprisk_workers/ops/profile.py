from collections.abc import Mapping
from pathlib import Path
from typing import Any

import duckdb

from sprisk_workers.output import PARQUET, Output


def profile(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
    """Per-column summary statistics, computed by DuckDB without loading the table."""
    path = out_dir / "profile.parquet"
    with duckdb.connect() as con:
        con.sql(
            "SUMMARIZE SELECT * FROM read_parquet($src)", params={"src": str(inputs["data"])}
        ).write_parquet(str(path))
    return [Output(port="profile", path=path, media_type=PARQUET)]
