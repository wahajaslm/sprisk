from typing import Any

from rule_harness import CLUSTERING, FOREST, LINEAR, alternative, column, decide, flow

RULE = "supervised/outlier_treatment"
SETTINGS = {"outlier_fraction_threshold": 0.05, "clip_k": 3.0}


def run(
    profile: dict[str, object], facts: dict[str, tuple[str, str]] | None = None
) -> dict[str, Any]:
    return decide(RULE, facts=facts, profile={"rows": 100, **profile}, settings=SETTINGS)


def test_many_outliers_are_clipped_to_the_train_iqr_fences() -> None:
    d = run({**column("income", outlier_share=0.08), **column("age", outlier_share=0.0)})
    assert d["recommended_alternative_id"] == "clip_iqr_fence"
    assert alternative(d, "clip_iqr_fence")["params"] == {"columns": ["age", "income"], "k": 3.0}
    assert "quartiles" in alternative(d, "clip_iqr_fence")["reason"]


def test_few_outliers_keep_the_values() -> None:
    d = run(column("age", outlier_share=0.01))
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "params" not in alternative(d, "none_tree_or_clean")


def test_no_isolation_forest_is_offered_without_an_operator() -> None:
    d = run(column("age", outlier_share=0.2))
    assert alternative(d, "isolation_forest_filter")["applicability"] == "not_applicable"


MANY = column("income", outlier_share=0.2)


def test_tree_models_downstream_keep_the_values_despite_outliers() -> None:
    d = run(MANY, FOREST)
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "rank order" in alternative(d, "none_tree_or_clean")["reason"]
    assert any(e["kind"] == "flow_fact" for e in d["evidence"])


def test_a_linear_model_downstream_clips_many_outliers_and_says_why() -> None:
    d = run(MANY, LINEAR)
    assert d["recommended_alternative_id"] == "clip_iqr_fence"
    assert "linear" in alternative(d, "none_tree_or_clean")["reason"]


def test_clustering_downstream_clips_many_outliers_and_says_why() -> None:
    d = run(MANY, CLUSTERING)
    assert d["recommended_alternative_id"] == "clip_iqr_fence"
    assert "cluster centres" in alternative(d, "none_tree_or_clean")["reason"]


def test_mixed_families_clip_many_outliers_for_the_models_they_pull() -> None:
    d = run(MANY, flow("mixed", "all", "all"))
    assert d["recommended_alternative_id"] == "clip_iqr_fence"
    assert "not tree" in alternative(d, "none_tree_or_clean")["reason"]


def test_no_model_downstream_clips_many_outliers_as_before_and_says_so() -> None:
    d = run(MANY)
    assert d["recommended_alternative_id"] == "clip_iqr_fence"
    assert "no model is downstream" in alternative(d, "none_tree_or_clean")["reason"]


def test_dbscan_downstream_keeps_outliers_it_marks_as_noise() -> None:
    d = run(MANY, flow("density_based", "none", "none"))
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "noise" in alternative(d, "none_tree_or_clean")["reason"]


def test_a_model_behind_a_step_the_rules_cannot_see_clips_many_outliers() -> None:
    d = run(MANY, flow("unknown", "some", "some"))
    assert d["recommended_alternative_id"] == "clip_iqr_fence"
    assert "cannot see" in alternative(d, "none_tree_or_clean")["reason"]


def test_models_that_ignore_their_features_keep_the_values() -> None:
    d = run(MANY, flow(None, "all", "all"))
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "ignore their features" in alternative(d, "none_tree_or_clean")["reason"]


TARGET = {"question.target": ("price", "confirmed")}


def test_the_target_is_never_clipped() -> None:
    d = run({**column("price", outlier_share=0.2), **column("age", outlier_share=0.2)}, TARGET)
    clip = alternative(d, "clip_iqr_fence")
    assert clip["params"]["columns"] == ["age"]
    assert "price" in clip["reason"]


def test_a_step_on_the_target_alone_cannot_clip_and_trees_are_not_called_immune() -> None:
    d = run(column("price", outlier_share=0.2), {**TARGET, **FOREST})
    assert alternative(d, "clip_iqr_fence")["applicability"] == "not_applicable"
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "trees included" in alternative(d, "none_tree_or_clean")["reason"]


def test_an_inferred_target_does_not_decide() -> None:
    d = run(column("price", outlier_share=0.2), {"question.target": ("price", "inferred")})
    assert alternative(d, "clip_iqr_fence")["params"]["columns"] == ["price"]
