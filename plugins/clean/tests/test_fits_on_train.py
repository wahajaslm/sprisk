"""Each manifest's `fits_on_train` claim, checked on the code. Rules trust it to treat a step's
train output as train rows only, and comparisons refit the step on each fold (ADR-0050)."""

import importlib
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
import pytest
import yaml
from polars.testing import assert_frame_equal
from scipy import sparse

PLUGINS = Path(__file__).parents[2]
# Settings that make each step do real work (on column x, y for encoding, t for grouping,
# d for dates, s for words).
SETTINGS: dict[str, dict[str, Any]] = {
    "sprisk.clean.impute@1.0.0": {"columns": ["x"], "method": "median"},
    "sprisk.clean.scale@1.0.0": {"columns": ["x"], "method": "z_score"},
    "sprisk.clean.clip_outliers@1.0.0": {"columns": ["x"], "k": 1.5},
    # y has no gaps, as encoding needs; its categories are learned from train.
    "sprisk.clean.encode@1.0.0": {"columns": ["y"]},
    # b is rare on train; c is seen only in test.
    "sprisk.clean.group_rare@1.0.0": {"columns": ["t"], "min_share": 0.2},
    "sprisk.clean.date_parts@1.0.0": {"columns": ["d"]},
    "sprisk.clean.leave_out@1.0.0": {"columns": ["t"]},
    "sprisk.clean.power_transform@1.0.0": {"columns": ["x"]},
    "sprisk.clean.vectorize_text@1.1.0": {"columns": ["s"]},
    "sprisk.clean.spectral_gating@1.0.0": {"signal_column": "x", "snr_column": "y"},
}
TRAIN_PORTS = ("train", "train_words")


def claimed() -> list[tuple[str, Callable[..., dict[str, pl.DataFrame]]]]:
    found = []
    for path in sorted(PLUGINS.glob("*/operators/*/manifest.yaml")):
        manifest = yaml.safe_load(path.read_text())
        if manifest.get("fits_on_train"):
            module, function = manifest["entrypoint"].split(":")
            found.append((manifest["id"], getattr(importlib.import_module(module), function)))
    return found


def test_every_step_that_claims_it_is_checked() -> None:
    assert sorted(ref for ref, _ in claimed()) == sorted(SETTINGS)


TRAIN = pl.DataFrame(
    {
        "x": [1.0, 2.0, None, 4.0, 5.0, 6.0, 7.0, 40.0],
        "y": [0, 1] * 4,
        "t": ["a", "a", "a", "b", "a", "a", "a", "a"],
        "d": [date(2024, 1, day) for day in range(1, 9)],
        "s": ["red shoe", "blue shoe", "red hat", None, "hat", "shoe", "red", "blue hat"],
    }
)
TEST = pl.DataFrame(
    {
        "x": [3.0, None, 100.0, -9.0],
        "y": [1, 0, 1, 0],
        "t": ["a", "b", "c", None],
        "d": [date(2025, 5, 1), None, date(2025, 12, 31), date(2026, 2, 28)],
        "s": ["red zebra", "zebra", None, "blue blue shoe"],
    }
)


@pytest.mark.parametrize(("ref", "step"), claimed())
def test_the_train_outputs_ignore_the_test_rows(ref: str, step: Callable[..., Any]) -> None:
    # Words the train rows use too: learning from test rows would change their weights.
    changed = TEST.with_columns(pl.col("x") * 1000, pl.col("s") + " red hat")
    first, other = step(TRAIN, TEST, **SETTINGS[ref]), step(TRAIN, changed, **SETTINGS[ref])
    for port in TRAIN_PORTS:
        if port in first:
            assert_same(first[port], other[port])


@pytest.mark.parametrize(("ref", "step"), claimed())
def test_each_test_row_depends_only_on_itself_and_the_train_rows(
    ref: str, step: Callable[..., Any]
) -> None:
    together = step(TRAIN, TEST, **SETTINGS[ref])
    alone = [step(TRAIN, TEST[i : i + 1], **SETTINGS[ref]) for i in range(4)]
    assert_frame_equal(together["test"], pl.concat(a["test"] for a in alone), check_exact=False)
    if "test_words" in together:
        rows = sparse.vstack([a["test_words"][0] for a in alone])
        # Stacked rows may sum in another order, so equal within rounding.
        assert abs(together["test_words"][0] - rows).max() == pytest.approx(0)


def assert_same(first: Any, other: Any) -> None:
    if isinstance(first, tuple):  # a matrix and its column names
        assert first[1] == other[1]
        assert (first[0] != other[0]).nnz == 0
    else:
        assert first.equals(other)
