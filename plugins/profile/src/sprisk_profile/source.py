"""A profile of a registered data source, read in place (ADR-0067).

Run as `python -m sprisk_profile.source` with a `SourceProfileRequest` as JSON on stdin. Rust
lists the files, checks them against the data roots and the version's fingerprint, sends their
resolved paths or object-store URIs, and starts one short process per request. Nothing is
copied: the files are read where they are, with the credentials in the environment, as Rust
lists them. A Parquet total comes from the files' metadata, and a larger one is sampled on whole
row groups chosen with a fixed seed, so a sorted file is not judged by its first rows. A CSV has
no row groups: it is read only as far as the sample, so a larger one has no counted total.
"""

import json
import os
import random
import sys
from typing import Any

import polars as pl
import pyarrow.fs as pafs
import pyarrow.parquet as pq
from pydantic import ValidationError

from sprisk_contracts import SourceProfileRequest

from .dataset import MAX_COLUMNS, MAX_ROWS, profile

# Same marker as the file_source step, so a source profiles as a flow would load it.
CSV_MISSING = ["NA"]
# Fixed, so a profile made once per fingerprint is the same profile when made again.
SEED = 0


def filesystem(location: str) -> tuple[pafs.FileSystem, str]:
    """The store a local path or `s3://`, `gs://` or `az://` URI is in, and its path there.
    Each reads its credentials from the environment, as Rust's object_store does; Azure names
    its account there too, since an `az://` URI holds only the container."""
    # Rust sends a local file as its resolved path, and an object as `scheme://bucket/key`
    # with the key as listed. Neither is parsed as a URL, which would cut it at `#` or `?`.
    if "://" not in location:
        return pafs.LocalFileSystem(), location
    scheme, path = location.split("://", 1)
    if scheme == "s3":
        return pafs.S3FileSystem(), path
    if scheme == "gs":
        return pafs.GcsFileSystem(), path
    if scheme == "az":
        account = os.environ.get("AZURE_STORAGE_ACCOUNT_NAME")
        if not account:
            raise ValueError(f"{location}: set AZURE_STORAGE_ACCOUNT_NAME to read from Azure")
        key = os.environ.get("AZURE_STORAGE_ACCOUNT_KEY")
        return pafs.AzureFileSystem(account_name=account, account_key=key), path
    raise ValueError(f"{location}: unsupported scheme {scheme!r}")


def read_source(
    format: str, files: list[str], max_rows: int = MAX_ROWS, max_columns: int = MAX_COLUMNS
) -> tuple[pl.DataFrame, int | None, int, dict[str, int] | None]:
    """The sampled rows and first columns of the files, their total rows (None: not counted),
    their column count, and the row groups sampled (None: the first rows, or all of them)."""
    if format == "parquet":
        return _read_parquet(files, max_rows, max_columns)
    if format != "csv":
        raise ValueError(f"unknown format {format!r}")
    # Polars reads an object by its URL, which would cut a key at `#` or `?`.
    cut = [f for f in files if "://" in f and ("#" in f or "?" in f)]
    if cut:
        raise ValueError(f"{cut[0]}: a key with # or ? cannot be read exactly")
    # glob=False: a path is read as named. A name like `*.csv` must not reach files Rust
    # never checked against the data roots.
    scan = pl.scan_csv(files, null_values=CSV_MISSING, glob=False)
    names = scan.collect_schema().names()
    # One row past the sample says whether a CSV goes on, without reading it to its end.
    data = scan.select(names[:max_columns]).head(max_rows + 1).collect()
    rows = data.height if data.height <= max_rows else None
    return data.head(max_rows), rows, len(names), None


def _read_parquet(
    files: list[str], max_rows: int, max_columns: int
) -> tuple[pl.DataFrame, int, int, dict[str, int] | None]:
    opened = [pq.ParquetFile(store.open_input_file(path)) for store, path in map(filesystem, files)]
    names = opened[0].schema_arrow.names
    columns = names[:max_columns]
    groups = [(f, g) for f, file in enumerate(opened) for g in range(file.num_row_groups)]
    size = {(f, g): opened[f].metadata.row_group(g).num_rows for f, g in groups}
    rows = sum(size.values())
    if rows <= max_rows:
        data = pl.concat([pl.DataFrame(file.read(columns=columns)) for file in opened])
        return data, rows, len(names), None
    if len(groups) == 1:
        return _head(opened[0], 0, columns, max_rows), rows, len(names), None
    shuffled = random.Random(SEED).sample(groups, len(groups))
    chosen, covered = [], 0
    for group in shuffled:
        chosen.append(group)
        covered += size[group]
        if covered >= max_rows:
            break
    # In file order, so a sample reads as the source does. The last chosen group is cut, and
    # read only as far as the cut: one group may be far larger than the sample.
    last = chosen[-1]
    parts = []
    for f, g in sorted(chosen):
        need = size[last] - (covered - max_rows) if (f, g) == last else size[(f, g)]
        parts.append(_head(opened[f], g, columns, need))
    sampled = {"seed": SEED, "chosen": len(chosen), "of": len(groups)}
    return pl.concat(parts), rows, len(names), sampled


def _head(file: pq.ParquetFile, group: int, columns: list[str], rows: int) -> pl.DataFrame:
    """The first `rows` of row group `group`, without reading the rest of it."""
    batch = next(file.iter_batches(batch_size=rows, row_groups=[group], columns=columns))
    return pl.DataFrame(batch)


def profile_source(
    format: str, files: list[str], target: str | None = None, max_rows: int = MAX_ROWS
) -> dict[str, Any]:
    data, rows, columns, sampled = read_source(format, files, max_rows=max_rows)
    made = profile(data, rows, columns, target)
    return made if sampled is None else {**made, "sampled_row_groups": sampled}


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
