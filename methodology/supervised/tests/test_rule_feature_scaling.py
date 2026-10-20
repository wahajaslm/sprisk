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
    assert d["recommended_alternative_id"] == "no_scaling"
    none = alternative(d, "no_scaling")
    assert none["applicability"] == "applicable"
    assert "params" not in none
    assert {
        "kind": "flow_fact",
        "label": "Model families downstream",
        "value": "tree_ensemble",
        "origin": "measured",
    } in d["evidence"]


def test_trees_that_do_not_standardise_still_need_no_scaling_for_rank_order_splits() -> None:
    d = run(HEAVY, flow("tree_ensemble", "none", "none"))
    assert d["recommended_alternative_id"] == "no_scaling"
    assert "rank order" in alternative(d, "no_scaling")["reason"]


def test_a_linear_model_that_standardises_itself_needs_no_scaling_step() -> None:
    d = run(HEAVY, LINEAR)
    assert d["recommended_alternative_id"] == "no_scaling"
    assert "standardise" in alternative(d, "no_scaling")["reason"]
    assert "no effect" in alternative(d, "robust_scaling")["reason"]
    assert "no effect" in alternative(d, "standard_scaling")["reason"]
    assert any(e["label"].startswith("Models downstream that standardise") for e in d["evidence"])


def test_clustering_downstream_is_scaled_from_the_tails() -> None:
    d = run(HEAVY, CLUSTERING)
    assert d["recommended_alternative_id"] == "robust_scaling"
    assert "distance_based" in alternative(d, "no_scaling")["reason"]


def test_a_forest_beside_clustering_is_scaled_for_the_clustering() -> None:
    d = run(LIGHT, flow("distance_based, tree_ensemble", "some", "some"))
    assert d["recommended_alternative_id"] == "standard_scaling"
    assert "Not every model" in alternative(d, "no_scaling")["reason"]


def test_no_model_downstream_is_scaled_as_before_and_says_so() -> None:
    d = run(LIGHT)
    assert d["recommended_alternative_id"] == "standard_scaling"
    assert "no model is downstream" in alternative(d, "no_scaling")["reason"]


def test_a_model_behind_a_step_the_rules_cannot_see_keeps_scaling_in_play() -> None:
    d = run(LIGHT, flow("tree_ensemble", "some", "some", hidden="some"))
    assert d["recommended_alternative_id"] == "standard_scaling", "seen trees do not vouch for it"
    assert "known to standardise" in alternative(d, "no_scaling")["reason"]


def test_dbscan_downstream_is_scaled_since_eps_is_a_distance() -> None:
    d = run(LIGHT, flow("density_based", "none", "none"))
    assert d["recommended_alternative_id"] == "standard_scaling"


def test_a_hidden_model_alone_is_not_said_to_take_its_inputs_as_they_are() -> None:
    d = run(LIGHT, flow(None, "none", "none", hidden="all"))
    assert "known to standardise" in alternative(d, "no_scaling")["reason"]


def test_models_that_ignore_their_features_need_no_scaling_step() -> None:
    d = run(HEAVY, flow("featureless", "none", "none"))
    assert d["recommended_alternative_id"] == "no_scaling"
    assert "ignore their features" in alternative(d, "no_scaling")["reason"]


def test_a_column_with_no_iqr_spread_cannot_be_robust_scaled() -> None:
    d = run(column("flag", "Int64", kurtosis=5.1, outlier_share=0.1, iqr=0.0))
    robust = alternative(d, "robust_scaling")
    assert robust["applicability"] == "not_applicable"
    assert "flag has no IQR spread" in robust["reason"]
    assert d["recommended_alternative_id"] == "standard_scaling"


def test_a_flat_iqr_column_is_left_out_of_robust_scaling_not_the_heavy_one() -> None:
    flag = column("flag", "Int64", kurtosis=5.1, outlier_share=0.1, iqr=0.0)
    d = run({**HEAVY, **flag})
    assert d["recommended_alternative_id"] == "robust_scaling"
    robust = alternative(d, "robust_scaling")
    assert robust["params"]["columns"] == ["income"]
    assert "Left out: flag has no IQR spread" in robust["reason"]
