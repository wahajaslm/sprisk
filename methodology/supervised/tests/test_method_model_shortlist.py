"""Which models are compared on the same folds (ADR-0044, ADR-0063 D3): the baseline and the
linear model always; the forest unless the rows are few or a person must follow each
prediction. The comparison, never decide(), picks the winner."""

from typing import Any

import pytest
from method_harness import decide

METHOD = "supervised/model_shortlist"


def rows(n: int) -> dict[str, Any]:
    return {"data.train_rows": {"rows": n}}


def test_enough_rows_compare_all_three_models() -> None:
    d = decide(METHOD, evidence=rows(500), statements={})
    assert d["answer"] == "shortlisted"
    assert d["shortlist"] == ["ml_dummy_baseline", "ml_linear_model", "ml_random_forest"]


def test_few_rows_leave_the_forest_off_and_say_the_default() -> None:
    d = decide(METHOD, evidence=rows(40), statements={})
    assert d["shortlist"] == ["ml_dummy_baseline", "ml_linear_model"]
    assert "40" in d["reason"] and "default" in d["reason"]


@pytest.mark.parametrize(("level", "forest"), [("high", False), ("medium", True), ("low", True)])
def test_only_high_interpretability_leaves_the_forest_off(level: str, forest: bool) -> None:
    d = decide(METHOD, evidence=rows(500), statements={"interpretability": level})
    assert ("ml_random_forest" in d["shortlist"]) is forest
    if not forest:
        assert "follow" in d["reason"]


def test_unmeasured_rows_compare_the_two_simple_models() -> None:
    d = decide(METHOD, evidence={}, statements={})
    assert d["shortlist"] == ["ml_dummy_baseline", "ml_linear_model"]
