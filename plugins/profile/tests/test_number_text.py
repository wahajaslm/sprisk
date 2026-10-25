import json
from pathlib import Path

import polars as pl

from sprisk_profile.number_text import number_text
from sprisk_workers.manifests import load_operators

MARKERS = "data.missing_markers"
NUMBERS = "data.number_text"


def test_a_number_column_with_known_placeholders_is_named_to_mark_then_cast() -> None:
    data = pl.DataFrame({"age": ["31", "?", "40", "n/a", "28", "55"], "city": ["a"] * 6})
    found = number_text(data)
    assert found[MARKERS] == {"columns": ["age"], "values": ["?", "n/a"], "unknown": []}
    assert found[NUMBERS]["numbers"] == []
    assert found[NUMBERS]["numbers_once_marked"] == ["age"]


def test_a_placeholder_is_matched_without_spaces_and_given_as_written() -> None:
    found = number_text(pl.DataFrame({"hours": ["40", " ?", "38", "41"]}))
    assert found[MARKERS]["values"] == [" ?"]


def test_a_value_that_may_be_real_is_named_never_marked() -> None:
    # "NA" is also Namibia's country code.
    found = number_text(pl.DataFrame({"code": ["1", "2", "NA", "3", "4"]}))
    assert found[MARKERS] == {"columns": [], "values": [], "unknown": ["code: 'NA'"]}
    assert found[NUMBERS]["numbers_once_marked"] == []


def test_numbers_stored_as_text_are_named_to_cast() -> None:
    found = number_text(pl.DataFrame({"price": ["1.5", "2", " 3 "], "name": ["a", "b", "c"]}))
    assert found[NUMBERS]["numbers"] == ["price"]
    assert found[NUMBERS]["numbers_once_marked"] == ["price"]


def test_codes_with_leading_zeros_stay_text() -> None:
    found = number_text(pl.DataFrame({"zip": ["01234", "75001", "02100"]}))
    assert found[NUMBERS]["numbers"] == []
    assert found[NUMBERS]["codes"] == ["zip"]


def test_numbers_written_with_a_comma_are_named_for_a_person() -> None:
    found = number_text(pl.DataFrame({"amount": ["1,000", "250", "2,5", "12"]}))
    assert found[NUMBERS]["comma_numbers"] == ["amount: '1,000', '2,5'"]
    assert found[NUMBERS]["numbers_once_marked"] == []


def test_mostly_text_columns_and_number_columns_are_left_alone() -> None:
    data = pl.DataFrame({"note": ["late", "ok", "3", "fine"], "n": [1, 2, 3, 4]})
    found = number_text(data)
    assert found[MARKERS] == {"columns": [], "values": [], "unknown": []}
    assert found[NUMBERS] == {
        "numbers": [],
        "numbers_once_marked": [],
        "codes": [],
        "comma_numbers": [],
    }


def test_the_worker_stores_both_kinds_in_one_evidence_set(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.number_text@1.0.0"]
    source = tmp_path / "data.parquet"
    pl.DataFrame({"age": ["31", "?", "40"]}).write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({}, {"data": source}, out)}
    assert sorted(json.loads(written["evidence"].path.read_text())) == [MARKERS, NUMBERS]


def test_the_worker_never_hands_it_the_target(tmp_path: Path) -> None:
    step = load_operators(Path(__file__).parents[2])["sprisk.profile.number_text@1.0.0"]
    source = tmp_path / "data.parquet"
    pl.DataFrame({"age": ["31", "?", "40"], "label": ["1", "?", "0"]}).write_parquet(source)
    out = tmp_path / "out"
    out.mkdir()
    written = {o.port: o for o in step.run({"target": "label"}, {"data": source}, out)}
    assert json.loads(written["evidence"].path.read_text())[MARKERS]["columns"] == ["age"]
