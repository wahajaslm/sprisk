from typing import Any

from rule_harness import CLUSTERING, FOREST, LINEAR, alternative, column, decide, flow

RULE = "supervised/feature_scaling"
SETTINGS = {"outlier_kurtosis_threshold": 3.0, "outlier_share_threshold": 0.05}


def run(
    profile: dict[str, object], facts: dict[str, tuple[str, str]] | None = None
) -> dict[str, Any]:
    return decide(RULE, facts=facts, profile={"rows": 100, **profile}, settings=SETTINGS)


def test_heavy_tails_get_robust_scaling() -> None:
    d = run({**column("income", kurtosis=9.0, outlier_share=0.07), **column("age", kurtosis=0.1)})
    assert d["recommended_alternative_id"] == "robust_scaling"
    assert alternative(d, "robust_scaling")["params"] == {
        "columns": ["age", "income"],
        "method": "robust",
    }


def test_light_tails_without_outliers_get_standard_scaling() -> None:
    d = run(column("age", kurtosis=0.2, outlier_share=0.0))
    assert d["recommended_alternative_id"] == "standard_scaling"
    assert alternative(d, "standard_scaling")["params"]["method"] == "z_score"


def test_text_columns_cannot_be_scaled() -> None:
    d = run(column("city", "String"))
    assert alternative(d, "standard_scaling")["applicability"] == "not_applicable"


def test_a_column_without_spread_cannot_be_scaled() -> None:
    d = run({**column("age", kurtosis=0.1), **column("flag")})
    assert alternative(d, "standard_scaling")["applicability"] == "not_applicable"
    assert "flag" in alternative(d, "standard_scaling")["reason"]


def test_a_few_values_outside_the_fences_are_normal_and_keep_standard_scaling() -> None:
    d = run(column("age", kurtosis=0.3, outlier_share=0.01))
    assert d["recommended_alternative_id"] == "standard_scaling"


HEAVY = column("income", kurtosis=9.0, outlier_share=0.07)
LIGHT = column("age", kurtosis=0.2, outlier_share=0.0)


def test_tree_models_downstream_need_no_scaling_step() -> None:
    d = run(HEAVY, FOREST)
    assert d["recommended_alternative_id"] == "none_tree_models"
    none = alternative(d, "none_tree_models")
    assert none["applicability"] == "applicable"
    assert "params" not in none
    assert {
        "kind": "flow_fact",
        "label": "Model family downstream",
        "value": "tree_ensemble",
        "origin": "measured",
    } in d["evidence"]


def test_trees_that_do_not_standardise_still_need_no_scaling_for_rank_order_splits() -> None:
    d = run(HEAVY, flow("tree_ensemble", "none", "none"))
    assert d["recommended_alternative_id"] == "none_tree_models"
    assert "rank order" in alternative(d, "none_tree_models")["reason"]


def test_a_linear_model_that_standardises_itself_needs_no_scaling_step() -> None:
    d = run(HEAVY, LINEAR)
    assert d["recommended_alternative_id"] == "none_tree_models"
    assert "standardise" in alternative(d, "none_tree_models")["reason"]
    assert "no effect" in alternative(d, "robust_scaling")["reason"]
    assert "no effect" in alternative(d, "standard_scaling")["reason"]
    assert any(e["label"].startswith("Models downstream that standardise") for e in d["evidence"])


def test_clustering_downstream_is_scaled_from_the_tails() -> None:
    d = run(HEAVY, CLUSTERING)
    assert d["recommended_alternative_id"] == "robust_scaling"
    assert "distance_based" in alternative(d, "none_tree_models")["reason"]


def test_a_forest_beside_clustering_is_scaled_for_the_clustering() -> None:
    d = run(LIGHT, flow("mixed", "some", "some"))
    assert d["recommended_alternative_id"] == "standard_scaling"
    assert "Not every model" in alternative(d, "none_tree_models")["reason"]


def test_no_model_downstream_is_scaled_as_before_and_says_so() -> None:
    d = run(LIGHT)
    assert d["recommended_alternative_id"] == "standard_scaling"
    assert "no model is downstream" in alternative(d, "none_tree_models")["reason"]
