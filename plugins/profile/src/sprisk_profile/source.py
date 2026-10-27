"""A profile of a registered data source, read in place (ADR-0067).

Run as `python -m sprisk_profile.source` with a `SourceProfileRequest` as JSON on stdin. Rust
lists the files, checks them against the data roots and the version's fingerprint, sends their
resolved paths, and starts one short process per request. Nothing is copied: Polars reads the
first rows of the files where they are. A Parquet total comes from the files' metadata; a CSV
is read only as far as the sample, so a larger one has no counted total.
"""

import json
import sys
from typing import Any

import polars as pl
from pydantic import ValidationError

from sprisk_contracts import SourceProfileRequest

from .dataset import MAX_COLUMNS, MAX_ROWS, profile

# Same marker as the file_source step, so a source profiles as a flow would load it.
CSV_MISSING = ["NA"]


def read_source(
    format: str, files: list[str], max_rows: int = MAX_ROWS, max_columns: int = MAX_COLUMNS
) -> tuple[pl.DataFrame, int | None, int]:
    """The first rows and columns of the files, their total rows (None: not counted) and their
    column count."""
    if format == "parquet":
        # glob=False: a path is read as named. A name like `*.csv` must not reach files Rust
        # never checked against the data roots.
        scan = pl.scan_parquet(files, glob=False)
    elif format == "csv":
        scan = pl.scan_csv(files, null_values=CSV_MISSING, glob=False)
    else:
        raise ValueError(f"unknown format {format!r}")
    names = scan.collect_schema().names()
    # One row past the sample says whether a CSV goes on, without reading it to its end.
    data = scan.select(names[:max_columns]).head(max_rows + 1).collect()
    if format == "parquet":
        rows: int | None = scan.select(pl.len()).collect().item()
    else:
        rows = data.height if data.height <= max_rows else None
    return data.head(max_rows), rows, len(names)


def profile_source(
    format: str, files: list[str], target: str | None = None, max_rows: int = MAX_ROWS
) -> dict[str, Any]:
    data, rows, columns = read_source(format, files, max_rows=max_rows)
    return profile(data, rows, columns, target)


def main() -> None:
    try:
        request = SourceProfileRequest.model_validate_json(sys.stdin.read())
    except ValidationError as e:
        sys.exit(f"invalid request: {e}")
    if not request.files:
        sys.exit("no files to profile")
    try:
        made = profile_source(request.format, [f.root for f in request.files], request.target)
    except (ValueError, OSError, pl.exceptions.PolarsError) as e:
        sys.exit(f"cannot read the source: {e}")
    sys.stdout.write(json.dumps(made, allow_nan=False))


if __name__ == "__main__":
    main()
