"""Each manifest's `fits_on_train` claim, checked on the code. Rules trust it to treat a step's
train output as train rows only, and comparisons refit the step on each fold (ADR-0050)."""

import importlib
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl
import pytest
import yaml
from polars.testing import assert_frame_equal

PLUGINS = Path(__file__).parents[2]
# Settings that make each step do real work on column x.
SETTINGS: dict[str, dict[str, Any]] = {
    "sprisk.clean.impute@1.0.0": {"columns": ["x"], "method": "median"},
    "sprisk.clean.scale@1.0.0": {"columns": ["x"], "method": "z_score"},
    "sprisk.clean.clip_outliers@1.0.0": {"columns": ["x"], "k": 1.5},
}


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


TRAIN = pl.DataFrame({"x": [1.0, 2.0, None, 4.0, 5.0, 6.0, 7.0, 40.0], "y": [0, 1] * 4})
TEST = pl.DataFrame({"x": [3.0, None, 100.0, -9.0], "y": [1, 0, 1, 0]})


@pytest.mark.parametrize(("ref", "step"), claimed())
def test_the_train_output_ignores_the_test_rows(ref: str, step: Callable[..., Any]) -> None:
    first = step(TRAIN, TEST, **SETTINGS[ref])["train"]
    other = step(TRAIN, TEST.with_columns(pl.col("x") * 1000), **SETTINGS[ref])["train"]
    assert first.equals(other)


@pytest.mark.parametrize(("ref", "step"), claimed())
def test_each_test_row_depends_only_on_itself_and_the_train_rows(
    ref: str, step: Callable[..., Any]
) -> None:
    together = step(TRAIN, TEST, **SETTINGS[ref])["test"]
    one_by_one = pl.concat(
        [step(TRAIN, TEST[i : i + 1], **SETTINGS[ref])["test"] for i in range(4)]
    )
    assert_frame_equal(together, one_by_one, check_exact=False)
