"""Which clustering algorithm fits the expected cluster shape (ADR-0042).

Cluster counts, eps and seeds are settings, not measurements: each reason says so, and
names the rule that should check the value.
"""

import json
from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_contracts.generated.models import Fact

LABELS = {
    "question.expected_cluster_geometry": "Expected cluster geometry",
    "question.soft_clustering_required": "Soft membership required",
    "question.noise_points_expected": "Noise points expected",
}


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    s = observation.settings
    geometry = _authoritative(facts.get("question.expected_cluster_geometry"))
    soft = _authoritative(facts.get("question.soft_clustering_required")) == "true"
    noise = _authoritative(facts.get("question.noise_points_expected")) == "true"

    kmeans = _applicable(
        "kmeans_centroid_clustering",
        f"Baseline for compact, convex clusters. K = {s['n_clusters']} is a setting, "
        "not measured: check it with the cluster count rule.",
        {
            "n_clusters": s["n_clusters"],
            "n_init": s["n_init"],
            "max_iter": s["max_iter"],
            "seed": s["seed"],
        },
    )
    dbscan = _applicable(
        "dbscan_density_clustering",
        f"Finds non-convex clusters and leaves noise unassigned. eps = {s['eps']} is a "
        "setting, not measured: check it with the neighbourhood rule.",
        {"eps": s["eps"], "min_samples": s["min_samples"]},
    )
    hierarchical = _not_applicable(
        "hierarchical_agglomerative", "No hierarchical clustering operator is installed."
    )
    gmm = _applicable(
        "gaussian_mixture_models",
        f"Gives each row a probability per cluster. {s['n_clusters']} components is a "
        "setting, not measured: check it with the cluster count rule.",
        {
            "n_components": s["n_clusters"],
            "covariance_type": s["covariance_type"],
            "seed": s["seed"],
        },
    )

    if geometry == "non_convex" or noise:
        recommended = "dbscan_density_clustering"
    elif soft:
        recommended = "gaussian_mixture_models"
    else:
        recommended = "kmeans_centroid_clustering"

    evidence = [
        {"kind": "question_fact", "label": label, "value": f.value, "origin": f.origin.value}
        for name, label in LABELS.items()
        if (f := facts.get(name)) is not None
    ]
    return RuleDecision.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_decision/v1",
                "rule": observation.rule.root,
                "recommended_alternative_id": recommended,
                "alternatives": [kmeans, dbscan, hierarchical, gmm],
                "evidence": evidence,
            }
        )
    )


def _authoritative(fact: Fact | None) -> str | None:
    if fact is None or fact.origin.value == "inferred":
        return None
    return fact.value


def _applicable(id: str, reason: str, params: dict[str, Any]) -> dict[str, Any]:
    return {"id": id, "applicability": "applicable", "reason": reason, "params": params}


def _not_applicable(id: str, reason: str) -> dict[str, Any]:
    return {"id": id, "applicability": "not_applicable", "reason": reason}
