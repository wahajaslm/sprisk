"""The loop-back rule (ADR-0059): a chosen model that beats the baseline but misses the success
bar reopens the features until the looks run out; no lift over the baseline stops."""

from typing import Any

import pytest
from rule_harness import alternative, decide

from sprisk_workers.errors import RuleError

RULE = "supervised/loop_back"


def results(
    score: float,
    beats: str = "yes",
    looks: int = 1,
    metric: str = "balanced_accuracy",
    selected: str = "yes",
) -> dict[str, Any]:
    return {
        "cv.metric": metric,
        "cv.score": score,
        "cv.baseline_score": 0.5,
        "cv.beats_baseline": beats,
        "cv.selected": selected,
        "cv.looks": looks,
    }


def bar(score: str, metric: str = "balanced_accuracy") -> dict[str, tuple[str, str]]:
    return {
        "question.success_bar.metric": (metric, "explicit"),
        "question.success_bar.score": (score, "explicit"),
    }


def states(d: dict[str, Any]) -> dict[str, str]:
    return {a["id"]: a["applicability"] for a in d["alternatives"]}


def test_a_chosen_model_that_meets_the_bar_proceeds_to_the_test_rows() -> None:
    d = decide(RULE, facts=bar("0.7"), profile=results(0.75))
    assert d["recommended_alternative_id"] == "proceed"
    assert states(d) == {
        "proceed": "applicable",
        "reopen": "not_applicable",
        "reopen_models": "not_applicable",
        "stop": "not_applicable",
    }
    reason = alternative(d, "proceed")["reason"]
    assert "0.75" in reason
    assert "optimistic" in reason


def test_below_the_bar_reopens_the_features() -> None:
    d = decide(RULE, facts=bar("0.8"), profile=results(0.75))
    assert d["recommended_alternative_id"] == "reopen"
    assert "0.8" in alternative(d, "reopen")["reason"]


def test_a_cost_bar_is_met_from_below() -> None:
    cost = results(1.2, metric="expected_cost")
    met = decide(RULE, facts=bar("1.5", "expected_cost"), profile=cost)
    missed = decide(RULE, facts=bar("1.0", "expected_cost"), profile=cost)
    assert met["recommended_alternative_id"] == "proceed"
    assert missed["recommended_alternative_id"] == "reopen"


def test_no_lift_over_the_baseline_stops_without_fishing_for_one() -> None:
    d = decide(RULE, profile=results(0.52, beats="no"))
    assert d["recommended_alternative_id"] == "stop"
    assert "no lift" in alternative(d, "stop")["reason"]
    assert alternative(d, "reopen")["applicability"] == "not_applicable"


def test_a_model_the_selection_did_not_choose_reopens_the_model_choice() -> None:
    d = decide(RULE, facts=bar("0.7"), profile=results(0.75, selected="no"))
    assert d["recommended_alternative_id"] == "reopen_models"
    assert alternative(d, "proceed")["applicability"] == "not_applicable"


def test_once_the_looks_run_out_it_stops_and_reports() -> None:
    capped = decide(RULE, facts=bar("0.8"), profile=results(0.75, looks=3))
    assert capped["recommended_alternative_id"] == "stop"
    assert "3 looks" in alternative(capped, "stop")["reason"]
    unchosen = decide(RULE, facts=bar("0.7"), profile=results(0.75, looks=3, selected="no"))
    assert unchosen["recommended_alternative_id"] == "stop"


def test_a_missing_bar_or_one_in_another_metric_asks() -> None:
    missing = decide(RULE, profile=results(0.75))
    assert missing["recommended_alternative_id"] == "proceed"
    assert alternative(missing, "proceed")["applicability"] == "needs_fact"
    assert "balanced accuracy" in alternative(missing, "proceed")["reason"]
    other = decide(RULE, facts=bar("1.0", "expected_cost"), profile=results(0.75))
    assert alternative(other, "proceed")["applicability"] == "needs_fact"
    assert "expected cost" in alternative(other, "proceed")["reason"]


@pytest.mark.parametrize("name", ["cv.beats_baseline", "cv.selected"])
def test_results_without_a_verdict_are_a_broken_observation(name: str) -> None:
    profile = results(0.75)
    del profile[name]
    with pytest.raises(RuleError, match=name):
        decide(RULE, facts=bar("0.7"), profile=profile)
