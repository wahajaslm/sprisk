"""Which clustering algorithm fits the expected cluster shape (ADR-0042).

Cluster counts, eps and seeds are settings, not measurements: each reason says so, and
names the rule that should check the value.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    not_applicable,
    question_evidence,
)

LABELS = {
    "question.expected_cluster_geometry": "Expected cluster geometry",
    "question.soft_clustering_required": "Soft membership required",
    "question.noise_points_expected": "Noise points expected",
}


def decide(observation: RuleObservation) -> RuleDecision:
    facts = observation.facts
    s = observation.settings
    geometry = authoritative(facts.get("question.expected_cluster_geometry"))
    soft = authoritative(facts.get("question.soft_clustering_required")) == "true"
    noise = authoritative(facts.get("question.noise_points_expected")) == "true"

    kmeans = applicable(
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
    dbscan = applicable(
        "dbscan_density_clustering",
        f"Finds non-convex clusters and leaves noise unassigned. eps = {s['eps']} is a "
        "setting, not measured: check it with the neighbourhood rule.",
        {"eps": s["eps"], "min_samples": s["min_samples"]},
    )
    hierarchical = not_applicable(
        "hierarchical_agglomerative", "No hierarchical clustering operator is installed."
    )
    gmm = applicable(
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

    return decision(
        observation,
        recommended,
        [kmeans, dbscan, hierarchical, gmm],
        question_evidence(observation, LABELS),
    )
