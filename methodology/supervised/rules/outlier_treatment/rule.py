"""Whether a step clips outliers, from the train rows' measured outlier shares (ADR-0042)."""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    measured,
    not_applicable,
    profile_evidence,
    step_columns,
)


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    columns = step_columns(observation)
    # A column without an outlier share has no variation, so it has no outliers to clip.
    share = {c: v for c in columns if (v := measured(observation, c, "outlier_share")) is not None}
    many = [c for c, v in share.items() if v >= s["outlier_fraction_threshold"]]

    # Keeping the step as it is changes no graph, so this choice has no params.
    keep = {
        "id": "none_tree_or_clean",
        "applicability": "applicable",
        "reason": "Few values fall outside the IQR fences: keep them as they are."
        if not many
        else "Keeps every value; outliers will pull linear models.",
    }
    clip = applicable(
        "clip_mean_sd",
        f"{', '.join(many)} has many values outside the IQR fences. The mean and SD are "
        "themselves pulled by those values, so clipping is milder than it looks."
        if many
        else "Available; few values would change.",
        {"columns": columns, "k": s["clip_k"]},
    )
    isolation = not_applicable(
        "isolation_forest_filter", "No isolation forest filter operator exists."
    )

    evidence = [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in share.items()]
    return decision(
        observation,
        "clip_mean_sd" if many else "none_tree_or_clean",
        [keep, clip, isolation],
        evidence,
    )
