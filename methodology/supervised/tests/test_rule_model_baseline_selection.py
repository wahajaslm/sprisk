from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/model_baseline_selection"
CANDIDATES = {
    "candidate.ml_dummy_baseline.family": ("featureless", "measured"),
    "candidate.ml_linear_model.family": ("linear", "measured"),
    "candidate.ml_random_forest.family": ("tree_ensemble", "measured"),
}
CLASSIFY = {"question.task": ("classification", "confirmed"), **CANDIDATES}


def run(
    rows: int, *columns: dict[str, Any], facts: dict[str, tuple[str, str]] = CLASSIFY
) -> dict[str, Any]:
    profile: dict[str, Any] = {"rows": rows}
    for c in columns or (column("age"),):
        profile.update(c)
    return decide(RULE, facts=facts, profile=profile)


def test_few_rows_shortlist_the_baseline_and_the_linear_model() -> None:
    d = run(40)
    assert d["shortlist"] == ["ml_dummy_baseline", "ml_linear_model"]
    assert "recommended_alternative_id" not in d
    assert "40" in alternative(d, "ml_random_forest")["reason"]


def test_enough_rows_add_the_forest() -> None:
    d = run(500)
    assert d["shortlist"] == ["ml_dummy_baseline", "ml_linear_model", "ml_random_forest"]
    assert "500" in alternative(d, "ml_random_forest")["reason"]


def test_the_baseline_is_always_on_the_list_and_says_why() -> None:
    for rows in (10, 5000):
        d = run(rows)
        assert "ml_dummy_baseline" in d["shortlist"]
        assert "beat" in alternative(d, "ml_dummy_baseline")["reason"]


def test_a_model_of_a_family_with_no_heuristic_is_compared_like_the_others() -> None:
    facts = {**CLASSIFY, "candidate.acme_boosted.family": ("boosted_trees", "measured")}
    d = run(40, facts=facts)
    assert "acme_boosted" in d["shortlist"]
    assert "boosted_trees" in alternative(d, "acme_boosted")["reason"]


def test_the_forest_threshold_is_named_as_a_default_not_a_source() -> None:
    reason = alternative(run(40), "ml_random_forest")["reason"]
    assert "default" in reason and "ESL" not in reason


def test_every_candidate_stays_applicable_so_any_can_be_chosen_with_a_reason() -> None:
    d = run(40)
    assert all(a["applicability"] == "applicable" for a in d["alternatives"])
