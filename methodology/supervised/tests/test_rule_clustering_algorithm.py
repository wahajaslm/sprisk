from typing import Any

from rule_harness import alternative
from rule_harness import decide as run

RULE = "unsupervised/clustering_algorithm"


def decide(facts: dict[str, tuple[str, str]]) -> dict[str, Any]:
    return run(RULE, facts=facts)


def test_without_shape_facts_kmeans_is_the_baseline_and_says_k_is_a_setting() -> None:
    d = decide({})
    assert d["recommended_alternative_id"] == "kmeans_centroid_clustering"
    kmeans = alternative(d, "kmeans_centroid_clustering")
    assert kmeans["params"] == {"n_clusters": 3, "n_init": 10, "max_iter": 300, "seed": 42}
    assert "setting" in kmeans["reason"]


def test_every_randomised_method_records_its_seed() -> None:
    d = decide({})
    assert alternative(d, "gaussian_mixture_models")["params"]["seed"] == 42


def test_hierarchical_is_not_offered_without_an_operator() -> None:
    d = decide({})
    hierarchical = alternative(d, "hierarchical_agglomerative")
    assert hierarchical["applicability"] == "not_applicable"
    assert "params" not in hierarchical
