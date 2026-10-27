import json
import subprocess
import sys
from pathlib import Path

import polars as pl
import pyarrow.fs as pafs
import pytest

from sprisk_contracts import DatasetProfile
from sprisk_profile.source import SEED, filesystem, profile_source, read_source


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

    data, rows, columns, _ = read_source("csv", [str(path)], max_rows=5)

    assert (data.height, rows, columns) == (5, 5, 2)


def test_a_csv_larger_than_the_sample_has_no_counted_total(tmp_path: Path) -> None:
    path = tmp_path / "t.csv"
    table(6).write_csv(path)

    data, rows, _, sampled = read_source("csv", [str(path)], max_rows=5)

    assert (data.height, rows, sampled) == (5, None, None)


def test_a_parquet_total_comes_from_every_file(tmp_path: Path) -> None:
    files = [tmp_path / "a.parquet", tmp_path / "b.parquet"]
    for f in files:
        table(4).write_parquet(f)

    data, rows, _, _ = read_source("parquet", [str(f) for f in files], max_rows=5)

    assert (data.height, rows) == (5, 8)


def test_only_the_first_columns_are_read(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    table(3).write_parquet(path)

    data, _, columns, _ = read_source("parquet", [str(path)], max_columns=1)

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

    done = run(json.dumps({"format": "parquet", "files": [str(f) for f in files]}))

    assert done.returncode == 0, done.stderr
    made = DatasetProfile.model_validate_json(done.stdout)
    assert (made.total_rows, made.profiled_rows) == (8, 8)


@pytest.mark.parametrize(
    "stdin",
    [
        '{"format": "json", "files": ["/x.json"]}',
        '{"format": "csv", "files": []}',
        "csv\n\n/x.csv\n",
    ],
)
def test_command_refuses_a_request_outside_the_contract(stdin: str) -> None:
    done = run(stdin)

    assert done.returncode != 0
    assert done.stdout == ""


def test_command_fails_loudly_on_a_file_it_cannot_read(tmp_path: Path) -> None:
    done = run(json.dumps({"format": "parquet", "files": [str(tmp_path / "missing.parquet")]}))

    assert done.returncode != 0
    assert done.stdout == ""


def test_a_path_is_read_as_named_never_as_a_pattern(tmp_path: Path) -> None:
    table(2).write_csv(tmp_path / "_hidden.csv")
    (tmp_path / "*.csv").write_text("x\n1\n")

    data, rows, _, _ = read_source("csv", [str(tmp_path / "*.csv")])

    assert (data.columns, rows) == (["x"], 1)


def grouped(path: Path, rows: int, group: int) -> None:
    table(rows).write_parquet(path, row_group_size=group)


def test_a_parquet_larger_than_the_sample_is_a_seeded_sample_of_whole_row_groups(
    tmp_path: Path,
) -> None:
    path = tmp_path / "t.parquet"
    grouped(path, 100, 10)

    data, rows, _, sampled = read_source("parquet", [str(path)], max_rows=30)

    assert (data.height, rows) == (30, 100)
    assert sampled == {"seed": SEED, "chosen": 3, "of": 10}
    groups = data["x"] // 10
    assert groups.value_counts()["count"].to_list() == [10, 10, 10], "whole groups"
    assert groups.unique().sort().to_list() != [0, 1, 2], "not the first rows"
    again, _, _, _ = read_source("parquet", [str(path)], max_rows=30)
    assert again.equals(data), "the same seed reads the same groups"


def test_the_last_chosen_group_is_cut_to_the_sample(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    grouped(path, 100, 10)

    data, _, _, sampled = read_source("parquet", [str(path)], max_rows=25)

    assert data.height == 25
    assert sampled is not None and sampled["chosen"] == 3


def test_row_groups_are_chosen_across_every_file(tmp_path: Path) -> None:
    files = [tmp_path / "a.parquet", tmp_path / "b.parquet"]
    for f in files:
        grouped(f, 50, 10)

    _, rows, _, sampled = read_source("parquet", [str(f) for f in files], max_rows=30)

    assert rows == 100
    assert sampled is not None and sampled["of"] == 10


def test_a_parquet_within_the_sample_is_read_whole_and_says_no_sample(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    grouped(path, 20, 10)

    data, rows, _, sampled = read_source("parquet", [str(path)], max_rows=30)

    assert (data.height, rows, sampled) == (20, 20, None)


def test_a_sampled_profile_names_its_row_groups(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    grouped(path, 100, 10)

    made = DatasetProfile.model_validate_json(
        json.dumps(profile_source("parquet", [str(path)], max_rows=30))
    )

    assert made.sampled_row_groups is not None
    assert (made.sampled_row_groups.chosen, made.sampled_row_groups.of) == (3, 10)


@pytest.mark.parametrize(
    ("uri", "kind", "path"),
    [
        ("/data/t.parquet", pafs.LocalFileSystem, "/data/t.parquet"),
        ("/data/a#b?.parquet", pafs.LocalFileSystem, "/data/a#b?.parquet"),
        ("s3://lake/events/t.parquet", pafs.S3FileSystem, "lake/events/t.parquet"),
        ("gs://lake/events/t.parquet", pafs.GcsFileSystem, "lake/events/t.parquet"),
        ("az://lake/events/t.parquet", pafs.AzureFileSystem, "lake/events/t.parquet"),
        ("s3://lake/a#b?c=d.parquet", pafs.S3FileSystem, "lake/a#b?c=d.parquet"),
    ],
)
def test_each_location_is_read_with_its_own_store(
    uri: str, kind: type, path: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Azure names its account outside the URI, as Rust's object_store reads it.
    monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_NAME", "acct")

    store, found = filesystem(uri)

    assert (type(store), found) == (kind, path)


def test_an_azure_location_without_an_account_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AZURE_STORAGE_ACCOUNT_NAME", raising=False)

    with pytest.raises(ValueError, match="AZURE_STORAGE_ACCOUNT_NAME"):
        filesystem("az://lake/t.parquet")


def test_a_single_row_group_is_its_first_rows_not_a_random_pick(tmp_path: Path) -> None:
    path = tmp_path / "t.parquet"
    grouped(path, 100, 100)

    data, rows, _, sampled = read_source("parquet", [str(path)], max_rows=30)

    assert (data["x"].to_list(), rows, sampled) == (list(range(30)), 100, None)


def test_an_object_csv_key_that_a_url_would_cut_is_refused() -> None:
    with pytest.raises(ValueError, match="cannot be read exactly"):
        read_source("csv", ["s3://lake/a#b.csv"])
