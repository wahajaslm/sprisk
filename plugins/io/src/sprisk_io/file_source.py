from collections.abc import Mapping
from pathlib import Path
from typing import Any

import polars as pl

from sprisk_workers.errors import OperatorError
from sprisk_workers.output import PARQUET, Output


def file_source(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """Read a local CSV or Parquet file into a Parquet table artifact."""
    src = Path(params["path"])
    if not src.is_file():
        raise OperatorError("source_not_found", f"no file at {src}")
    lazy = pl.scan_csv(src) if params["format"] == "csv" else pl.scan_parquet(src)
    path = out_dir / "data.parquet"
    lazy.sink_parquet(path)
    return [Output(port="data", path=path, media_type=PARQUET)]
