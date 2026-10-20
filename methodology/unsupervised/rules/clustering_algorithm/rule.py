"""Which clustering algorithm a clustering step uses (ADR-0042).

The question does not record the expected cluster shape, soft membership or noise yet, so
k-means is the baseline and the others are offered with what they suit. Cluster counts, eps
and seeds are settings, not measurements: each reason says so, and names the rule that should
check the value.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import applicable, decision, not_applicable


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings

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

    return decision(
        observation,
        "kmeans_centroid_clustering",
        [kmeans, dbscan, hierarchical, gmm],
        [],
    )
