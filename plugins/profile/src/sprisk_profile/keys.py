"""How the rows a step reads match another table, per column both share (ADR-0059).

Run as `python -m sprisk_profile.keys` with two Parquet paths on stdin, one per line: the
step's table, then the other; prints `KeyMatches` as JSON. Key matching is structure, nothing
fitted, so all rows are read, lazily: only counts are collected, never the tables. Rust starts
one short process per request, bounds its time and checks the answer against the contract.
"""

import json
import sys
from typing import Any

import polars as pl

from .dataset import MAX_COLUMNS


def key_matches(data: pl.LazyFrame, other: pl.LazyFrame) -> dict[str, Any]:
    names, other_names = data.collect_schema(), other.collect_schema()
    shared = [c for c in names if c in other_names][:MAX_COLUMNS]
    return {
        "schema_version": "sprisk.key_matches/v1",
        "rows": _count(data),
        "other_rows": _count(other),
        "keys": [_match(data, other, c, names[c] == other_names[c]) for c in shared],
    }


def _count(table: pl.LazyFrame) -> int:
    return int(table.select(pl.len()).collect().item())


def _match(data: pl.LazyFrame, other: pl.LazyFrame, column: str, same_type: bool) -> dict[str, Any]:
    values = other.select(column).drop_nulls()
    # A value of another type never equals one of these, so nothing matches. A semi join
    # never matches a missing value.
    matched = _count(data.join(values.unique(), on=column, how="semi")) if same_type else 0
    most = values.group_by(column).len().select(pl.col("len").max()).collect().item()
    return {"column": column, "matched_rows": matched, "most_rows_per_key": int(most or 0)}


def main() -> None:
    paths = sys.stdin.read().split()
    if len(paths) != 2:
        sys.exit(f"expected two Parquet paths, got {len(paths)}")
    left, right = paths
    try:
        found = key_matches(pl.scan_parquet(left), pl.scan_parquet(right))
    except (OSError, pl.exceptions.PolarsError) as e:
        sys.exit(f"cannot read {left} and {right}: {e}")
    sys.stdout.write(json.dumps(found))


if __name__ == "__main__":
    main()
