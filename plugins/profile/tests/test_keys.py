import json
import subprocess
import sys
from pathlib import Path

import polars as pl
import pytest

from sprisk_contracts import KeyMatches
from sprisk_profile.keys import key_matches

ITEMS = pl.DataFrame({"unnamed_0": [0, 1, 2, None], "designation": ["a", "b", "c", "d"]})


def matches(data: pl.DataFrame, other: pl.DataFrame) -> dict[str, object]:
    return key_matches(data.lazy(), other.lazy())


def test_each_shared_column_counts_matching_rows_and_the_most_rows_one_key_finds() -> None:
    codes = pl.DataFrame({"unnamed_0": [0, 1, 1, 7], "prdtypecode": [10, 20, 20, 30]})
    found = matches(ITEMS, codes)
    assert found == {
        "schema_version": "sprisk.key_matches/v1",
        "rows": 4,
        "other_rows": 4,
        "keys": [{"column": "unnamed_0", "matched_rows": 2, "most_rows_per_key": 2}],
    }
    KeyMatches.model_validate_json(json.dumps(found))


def test_tables_that_share_no_column_have_no_keys_but_keep_their_row_counts() -> None:
    found = matches(ITEMS, pl.DataFrame({"code": [1, 2]}))
    assert (found["keys"], found["rows"], found["other_rows"]) == ([], 4, 2)


def test_a_shared_column_of_another_type_matches_nothing() -> None:
    keys = matches(ITEMS, pl.DataFrame({"unnamed_0": ["0", "1"]}))["keys"]
    assert keys == [{"column": "unnamed_0", "matched_rows": 0, "most_rows_per_key": 1}]


def run(stdin: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "sprisk_profile.keys"], input=stdin, capture_output=True, text=True
    )


def test_it_runs_as_a_process_reading_two_parquet_paths(tmp_path: Path) -> None:
    left, right = tmp_path / "x.parquet", tmp_path / "y.parquet"
    ITEMS.write_parquet(left)
    pl.DataFrame({"unnamed_0": [0, 1, 2]}).write_parquet(right)
    done = run(f"{left}\n{right}\n")
    assert done.returncode == 0, done.stderr
    assert KeyMatches.model_validate_json(done.stdout).keys[0].matched_rows == 3


@pytest.mark.parametrize("paths", [1, 3])
def test_anything_but_two_paths_is_refused(tmp_path: Path, paths: int) -> None:
    done = run("\n".join(str(tmp_path / f"{i}.parquet") for i in range(paths)))
    assert done.returncode != 0
    assert "two Parquet paths" in done.stderr


def test_an_unreadable_table_is_refused_naming_it(tmp_path: Path) -> None:
    done = run(f"{tmp_path / 'x.parquet'}\n{tmp_path / 'y.parquet'}\n")
    assert done.returncode != 0
    assert "x.parquet" in done.stderr
