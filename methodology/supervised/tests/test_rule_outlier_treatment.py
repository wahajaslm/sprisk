from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/outlier_treatment"
SETTINGS = {"outlier_fraction_threshold": 0.05, "clip_k": 3.0}


def run(profile: dict[str, object], family: str | None = None) -> dict[str, Any]:
    facts = {"flow.model_family": (family, "measured")} if family else {}
    return decide(RULE, facts=facts, profile={"rows": 100, **profile}, settings=SETTINGS)


def test_many_outliers_are_clipped_to_the_train_mean_plus_k_sd() -> None:
    d = run({**column("income", outlier_share=0.08), **column("age", outlier_share=0.0)})
    assert d["recommended_alternative_id"] == "clip_mean_sd"
    assert alternative(d, "clip_mean_sd")["params"] == {"columns": ["age", "income"], "k": 3.0}


def test_few_outliers_keep_the_values() -> None:
    d = run(column("age", outlier_share=0.01))
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "params" not in alternative(d, "none_tree_or_clean")


def test_no_isolation_forest_is_offered_without_an_operator() -> None:
    d = run(column("age", outlier_share=0.2))
    assert alternative(d, "isolation_forest_filter")["applicability"] == "not_applicable"


def test_tree_models_downstream_keep_the_values_despite_outliers() -> None:
    d = run(column("income", outlier_share=0.2), family="tree_ensemble")
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "rank" in alternative(d, "none_tree_or_clean")["reason"]
    assert any(e["kind"] == "flow_fact" for e in d["evidence"])


def test_an_unknown_or_mixed_family_clips_many_outliers_as_today() -> None:
    for family in (None, "mixed"):
        d = run(column("income", outlier_share=0.2), family=family)
        assert d["recommended_alternative_id"] == "clip_mean_sd"
        assert "unknown" in alternative(d, "none_tree_or_clean")["reason"]
