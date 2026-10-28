"""Loop back (ADR-0059, ADR-0063 slice 6): the comparison's winner proceeds to the test rows
when it meets the success bar; below it the walk stops naming the features to change, until
the looks run out; no lift over the baseline stops."""

from typing import Any

from method_harness import decide

METHOD = "supervised/loop_back"


def found(
    score: float, beats: bool = True, looks: int = 1, metric: str = "balanced_accuracy"
) -> dict[str, Any]:
    return {
        "models.comparison": {
            "metric": metric,
            "score": score,
            "baseline_score": 0.5,
            "beats_baseline": beats,
            "looks": looks,
        }
    }


def bar(score: float, metric: str = "balanced_accuracy") -> dict[str, Any]:
    return {"success_bar": {"metric": metric, "score": score}}


def loop_back(evidence: dict[str, Any], statements: dict[str, Any]) -> dict[str, Any]:
    chosen = {"models.estimator_selection": "ml_linear_model"}
    return decide(METHOD, evidence=evidence, decisions=chosen, statements=statements)


def test_a_winner_that_meets_the_bar_proceeds_and_says_its_score_is_optimistic() -> None:
    d = loop_back(found(0.75), bar(0.7))
    assert (d["outcome"], d["option"]) == ("choose", "proceed")
    assert "0.75" in d["reason"] and "optimistic" in d["reason"]


def test_below_the_bar_reopens_the_features_naming_the_looks_left() -> None:
    d = loop_back(found(0.75), bar(0.8))
    assert d["option"] == "reopen"
    assert "0.8" in d["reason"] and "1 of 3 looks" in d["reason"]


def test_a_cost_bar_is_met_from_below() -> None:
    cost = found(1.2, metric="expected_cost")
    assert loop_back(cost, bar(1.5, "expected_cost"))["option"] == "proceed"
    assert loop_back(cost, bar(1.0, "expected_cost"))["option"] == "reopen"


def test_a_weighted_f1_bar_is_met_from_above() -> None:
    f1 = found(0.82, metric="weighted_f1")
    met = loop_back(f1, bar(0.81, "weighted_f1"))
    assert met["option"] == "proceed" and "weighted F1" in met["reason"]
    assert loop_back(f1, bar(0.85, "weighted_f1"))["option"] == "reopen"


def test_no_lift_over_the_baseline_stops_without_fishing_for_one() -> None:
    d = loop_back(found(0.52, beats=False), bar(0.7))
    assert d["option"] == "stop" and "no lift" in d["reason"]


def test_once_the_looks_run_out_it_stops_and_reports() -> None:
    d = loop_back(found(0.75, looks=3), bar(0.8))
    assert d["option"] == "stop" and "3 looks" in d["reason"]


def test_a_missing_bar_or_one_in_another_metric_is_asked() -> None:
    missing = loop_back(found(0.75), {})
    assert (missing["outcome"], missing["option"]) == ("ask", "proceed")
    assert "balanced accuracy" in missing["reason"]
    other = loop_back(found(0.75), bar(1.0, "expected_cost"))
    assert other["outcome"] == "ask" and "expected cost" in other["reason"]
