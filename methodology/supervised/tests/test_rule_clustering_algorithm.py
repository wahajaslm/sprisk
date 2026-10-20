import json
from pathlib import Path
from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import load_decide

RULE = Path(__file__).parents[2] / "unsupervised" / "rules" / "clustering_algorithm" / "rule.py"
SETTINGS = {
    "n_clusters": 3,
    "n_init": 10,
    "max_iter": 300,
    "seed": 42,
    "eps": 0.5,
    "min_samples": 5,
    "covariance_type": "full",
}


def decide(facts: dict[str, tuple[str, str]]) -> dict[str, Any]:
    observation = RuleObservation.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_observation/v1",
                "rule": "methodology.unsupervised.clustering_algorithm@1.0.0",
                "facts": {k: {"value": v, "origin": o} for k, (v, o) in facts.items()},
                "profile": {},
                "settings": SETTINGS,
            }
        )
    )
    decision: RuleDecision = load_decide(RULE)(observation)
    result: dict[str, Any] = json.loads(decision.model_dump_json())
    return result


def alternative(decision: dict[str, Any], id: str) -> dict[str, Any]:
    return next(a for a in decision["alternatives"] if a["id"] == id)


def test_without_shape_facts_kmeans_is_the_baseline_and_says_k_is_a_setting() -> None:
    d = decide({})
    assert d["recommended_alternative_id"] == "kmeans_centroid_clustering"
    kmeans = alternative(d, "kmeans_centroid_clustering")
    assert kmeans["params"] == {"n_clusters": 3, "n_init": 10, "max_iter": 300, "seed": 42}
    assert "setting" in kmeans["reason"]


def test_every_randomised_method_records_its_seed() -> None:
    d = decide({})
    assert alternative(d, "gaussian_mixture_models")["params"]["seed"] == 42


def test_non_convex_geometry_recommends_dbscan() -> None:
    d = decide({"question.expected_cluster_geometry": ("non_convex", "confirmed")})
    assert d["recommended_alternative_id"] == "dbscan_density_clustering"


def test_soft_membership_recommends_a_gaussian_mixture() -> None:
    d = decide({"question.soft_clustering_required": ("true", "confirmed")})
    assert d["recommended_alternative_id"] == "gaussian_mixture_models"


def test_an_inferred_geometry_never_decides() -> None:
    d = decide({"question.expected_cluster_geometry": ("non_convex", "inferred")})
    assert d["recommended_alternative_id"] == "kmeans_centroid_clustering"


def test_hierarchical_is_not_offered_without_an_operator() -> None:
    d = decide({})
    hierarchical = alternative(d, "hierarchical_agglomerative")
    assert hierarchical["applicability"] == "not_applicable"
    assert "params" not in hierarchical
