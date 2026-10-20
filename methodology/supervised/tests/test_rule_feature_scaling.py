from typing import Any

from rule_harness import alternative, column, decide

RULE = "supervised/feature_scaling"
SETTINGS = {"outlier_kurtosis_threshold": 3.0, "outlier_share_threshold": 0.05}


def run(profile: dict[str, object], family: str | None = None) -> dict[str, Any]:
    facts = {"flow.model_family": (family, "measured")} if family else {}
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


def test_tree_models_downstream_need_no_scaling() -> None:
    d = run(column("income", kurtosis=9.0, outlier_share=0.07), family="tree_ensemble")
    assert d["recommended_alternative_id"] == "none_tree_models"
    trees = alternative(d, "none_tree_models")
    assert trees["applicability"] == "applicable"
    assert "params" not in trees
    assert {
        "kind": "flow_fact",
        "label": "Model family downstream",
        "value": "tree_ensemble",
        "origin": "measured",
    } in d["evidence"]


def test_a_linear_model_downstream_is_scaled_as_today() -> None:
    d = run(column("age", kurtosis=0.2, outlier_share=0.0), family="linear")
    assert d["recommended_alternative_id"] == "standard_scaling"
    assert "linear" in alternative(d, "none_tree_models")["reason"]


def test_an_unknown_or_mixed_family_is_scaled_as_today() -> None:
    for family in (None, "mixed"):
        d = run(column("age", kurtosis=0.2, outlier_share=0.0), family=family)
        assert d["recommended_alternative_id"] == "standard_scaling"
        assert "unknown" in alternative(d, "none_tree_models")["reason"]
