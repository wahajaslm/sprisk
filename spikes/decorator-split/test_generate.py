"""The compiled Method IR and the screen's data must match the pack, and the screen's rules
must hold: no plot that reads labels before the final score, no run without its columns."""

from pathlib import Path

import polars as pl
import pytest

import validation
from generate import OUT, ROWS, SCREEN, main, option_entry, view_entry
from split_method import split
from sprisk import method_manifest, operator, operator_manifest
from validation import stratified_split
from validation.stratified_split import class_shares
from validation.temporal_split import test_after_train as promise_test_after_train


def test_the_checked_in_output_is_what_the_pack_compiles_to(tmp_path: Path) -> None:
    main(tmp_path / "ir", tmp_path / "screen.json")

    fresh = {f.name: f.read_text() for f in (tmp_path / "ir").iterdir()}
    assert fresh == {f.name: f.read_text() for f in OUT.iterdir()}
    assert (tmp_path / "screen.json").read_text() == SCREEN.read_text()


def _entry(option_id: str) -> dict[str, object]:
    method = method_manifest(split, "methodology.supervised", validation.PACK, "1.0.0")
    (option,) = [o for o in method["options"] if o["id"] == option_id]
    op = split.__sprisk__["options"][option_id].operator
    return option_entry(option, operator_manifest(op, validation.PACK, validation.VERSION))


def test_a_view_that_reads_a_label_waits_for_the_final_score() -> None:
    step = stratified_split(ROWS, stratify="product_type")

    entry = view_entry(class_shares, stratified_split, step, {"stratify": "product_type"})

    assert entry["final_only"] is True
    assert entry["figure"] is None


def test_an_option_whose_column_is_not_bound_does_not_run() -> None:
    entry = _entry("temporal")

    assert entry["unbound"] == ["common.event_time"]
    assert entry["verifications"] == []
    assert all(view["figure"] is None for view in entry["plots"])


def test_an_option_with_its_columns_bound_runs_and_is_verified() -> None:
    entry = _entry("item_groups")

    assert [v["status"] for v in entry["verifications"]] == ["pass"]
    assert all(view["figure"] is not None for view in entry["plots"])


def test_a_setting_without_a_json_type_names_the_operator_and_setting() -> None:
    @operator(id="odd", inputs=["data"], outputs=[], role="split", folds="plain")
    def odd(data: pl.DataFrame, when: bytes = b""): ...

    with pytest.raises(TypeError, match="odd.when: annotation <class 'bytes'> has no JSON type"):
        operator_manifest(odd, validation.PACK, validation.VERSION)


def test_time_order_is_inconclusive_when_a_side_is_empty() -> None:
    empty = pl.DataFrame({"day": []}, schema={"day": pl.Int64})
    some = pl.DataFrame({"day": [1, 2]})

    assert promise_test_after_train(empty, some, time_column="day").status == "inconclusive"
