from typing import Any

from rule_harness import CLUSTERING, FOREST, LINEAR, alternative, column, decide, flow

RULE = "supervised/outlier_treatment"
SETTINGS = {"outlier_fraction_threshold": 0.05, "clip_k": 3.0}


def run(
    profile: dict[str, object], facts: dict[str, tuple[str, str]] | None = None
) -> dict[str, Any]:
    return decide(RULE, facts=facts, profile={"rows": 100, **profile}, settings=SETTINGS)


def test_many_outliers_are_clipped_to_the_train_iqr_fences() -> None:
    d = run(
        {
            **column("income", iqr=1.0, outlier_share=0.08),
            **column("age", iqr=1.0, outlier_share=0.0),
        }
    )
    assert d["recommended_alternative_id"] == "clip_iqr_fence"
    assert alternative(d, "clip_iqr_fence")["params"] == {"columns": ["age", "income"], "k": 3.0}
    assert "quartiles" in alternative(d, "clip_iqr_fence")["reason"]


def test_few_outliers_keep_the_values() -> None:
    d = run(column("age", iqr=1.0, outlier_share=0.01))
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "params" not in alternative(d, "none_tree_or_clean")


def test_no_isolation_forest_is_offered_without_an_operator() -> None:
    d = run(column("age", iqr=1.0, outlier_share=0.2))
    assert alternative(d, "isolation_forest_filter")["applicability"] == "not_applicable"


MANY = column("income", iqr=1.0, outlier_share=0.2)


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
    assert "behind another step" in alternative(d, "none_tree_or_clean")["reason"]


def test_models_that_ignore_their_features_keep_the_values() -> None:
    d = run(MANY, flow("featureless", "all", "all"))
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "ignore their features" in alternative(d, "none_tree_or_clean")["reason"]


TARGET = {"question.target": ("price", "confirmed")}


def test_the_target_is_never_clipped() -> None:
    d = run(
        {
            **column("price", iqr=1.0, outlier_share=0.2),
            **column("age", iqr=1.0, outlier_share=0.2),
        },
        TARGET,
    )
    clip = alternative(d, "clip_iqr_fence")
    assert clip["params"]["columns"] == ["age"]
    assert "price" in clip["reason"]


def test_a_step_on_the_target_alone_cannot_clip_and_trees_are_not_called_immune() -> None:
    d = run(column("price", iqr=1.0, outlier_share=0.2), {**REGRESSION, **FOREST})
    assert alternative(d, "clip_iqr_fence")["applicability"] == "not_applicable"
    assert d["recommended_alternative_id"] == "none_tree_or_clean"
    assert "trees included" in alternative(d, "none_tree_or_clean")["reason"]


def test_a_column_that_may_be_the_target_asks_before_it_is_clipped() -> None:
    d = run(column("price", iqr=1.0, outlier_share=0.2), {"question.target": ("price", "inferred")})
    clip = alternative(d, "clip_iqr_fence")
    assert clip["applicability"] == "needs_fact"
    assert "Confirm" in clip["reason"]
    assert d["recommended_alternative_id"] == "none_tree_or_clean"


REGRESSION = {**TARGET, "question.task": ("regression", "confirmed")}


def test_target_outliers_are_said_to_pull_squared_error_fits_only_in_regression() -> None:
    step = {
        **column("price", iqr=1.0, outlier_share=0.2),
        **column("age", iqr=1.0, outlier_share=0.0),
    }
    assert "squared-error" in alternative(run(step, REGRESSION), "none_tree_or_clean")["reason"]
    classes = {**TARGET, "question.task": ("classification", "confirmed")}
    assert "squared-error" not in alternative(run(step, classes), "none_tree_or_clean")["reason"]


def test_an_inferred_target_outside_the_step_does_not_stop_clipping() -> None:
    d = run(MANY, {"question.target": ("price", "inferred")})
    assert d["recommended_alternative_id"] == "clip_iqr_fence"


def test_a_column_with_no_iqr_spread_is_left_out_of_the_clip() -> None:
    flag = column("flag", "Int64", iqr=0.0, outlier_share=0.1)
    d = run({**flag, **column("age", iqr=5.0, outlier_share=0.2)})
    clip = alternative(d, "clip_iqr_fence")
    assert clip["params"]["columns"] == ["age"]
    assert "flag has no IQR spread" in clip["reason"]


def test_a_step_with_only_flat_iqr_columns_cannot_clip() -> None:
    d = run(column("flag", "Int64", iqr=0.0, outlier_share=0.1))
    assert alternative(d, "clip_iqr_fence")["applicability"] == "not_applicable"
    assert d["recommended_alternative_id"] == "none_tree_or_clean"


def test_keeping_values_when_only_flat_columns_cross_the_threshold_says_why() -> None:
    d = run(column("flag", "Int64", iqr=0.0, outlier_share=0.1))
    keep = alternative(d, "none_tree_or_clean")["reason"]
    assert "Few values" not in keep
    assert "no IQR spread" in keep


def test_the_task_is_evidence_only_when_it_was_weighed() -> None:
    quiet = {
        **column("price", iqr=1.0, outlier_share=0.0),
        **column("age", iqr=1.0, outlier_share=0.0),
    }
    d = run(quiet, REGRESSION)
    assert not any(e["label"] == "Task" for e in d["evidence"])
