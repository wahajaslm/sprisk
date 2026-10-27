import json
import subprocess
import sys
from pathlib import Path

import polars as pl
import pytest

from sprisk_contracts import DatasetProfile
from sprisk_profile.source import profile_source, read_source


def table(rows: int) -> pl.DataFrame:
    return pl.DataFrame({"x": list(range(rows)), "y": [f"v{i % 3}" for i in range(rows)]})


def run(stdin: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "sprisk_profile.source"],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_a_csv_read_to_its_end_knows_its_total(tmp_path: Path) -> None:
    path = tmp_path / "t.csv"
    table(5).write_csv(path)

    data, rows, columns = read_source("csv", [str(path)], max_rows=5)

    assert (data.height, rows, columns) == (5, 5, 2)


def test_a_csv_larger_than_the_sample_has_no_counted_total(tmp_path: Path) -> None:
    path = tmp_path / "t.csv"
    table(6).write_csv(path)

    data, rows, _ = read_source("csv", [str(path)], max_rows=5)

    assert (data.height, rows) == (5, None)


def test_a_parquet_total_comes_from_every_file(tmp_path: Path) -> None:
    files = [tmp_path / "a.parquet", tmp_path / "b.parquet"]
    for f in files:
        table(4).write_parquet(f)

    data, rows, _ = read_source("parquet", [str(f) for f in files], max_rows=5)

    assert (data.height, rows) == (5, 8)


def test_only_the_first_columns_are_read(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    table(3).write_parquet(path)

    data, _, columns = read_source("parquet", [str(path)], max_columns=1)

    assert (data.columns, columns) == (["x"], 2)


def test_a_profile_of_an_uncounted_source_omits_its_total(tmp_path: Path) -> None:
    path = tmp_path / "t.csv"
    table(6).write_csv(path)

    made = DatasetProfile.model_validate_json(
        json.dumps(profile_source("csv", [str(path)], max_rows=5))
    )

    assert (made.total_rows, made.profiled_rows) == (None, 5)
    # Rows equal to an earlier one may lie past the sample, so they are not counted.
    assert made.duplicate_rows is None


def test_command_profiles_a_folder_of_parquet_files_with_their_total(tmp_path: Path) -> None:
    files = [tmp_path / "a.parquet", tmp_path / "b.parquet"]
    for f in files:
        table(4).write_parquet(f)

    done = run("parquet\n\n" + "\n".join(str(f) for f in files) + "\n")

    assert done.returncode == 0, done.stderr
    made = DatasetProfile.model_validate_json(done.stdout)
    assert (made.total_rows, made.profiled_rows) == (8, 8)


@pytest.mark.parametrize("stdin", ["json\n\n/x.json\n", "csv\n\n"])
def test_command_refuses_an_unknown_format_or_no_files(stdin: str) -> None:
    done = run(stdin)

    assert done.returncode != 0
    assert done.stdout == ""


def test_command_fails_loudly_on_a_file_it_cannot_read(tmp_path: Path) -> None:
    done = run(f"parquet\n\n{tmp_path / 'missing.parquet'}\n")

    assert done.returncode != 0
    assert done.stdout == ""
