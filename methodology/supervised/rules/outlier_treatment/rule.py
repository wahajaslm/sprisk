"""Whether a step clips outliers, from the models downstream and the train rows' measured
outlier shares (ADR-0042). Trees split on rank order, so outliers do not pull them."""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    family_evidence,
    measured,
    model_family,
    not_applicable,
    profile_evidence,
    step_columns,
    unknown_family,
)


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    family = model_family(observation)
    trees = family == "tree_ensemble"
    columns = step_columns(observation)
    # A column without an outlier share has no variation, so it has no outliers to clip.
    share = {c: v for c in columns if (v := measured(observation, c, "outlier_share")) is not None}
    many = [c for c, v in share.items() if v >= s["outlier_fraction_threshold"]]

    # Keeping the step as it is changes no graph, so this choice has no params.
    keep = {
        "id": "none_tree_or_clean",
        "applicability": "applicable",
        "reason": _keep_reason(many, family),
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

    evidence = family_evidence(family)
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in share.items()]
    return decision(
        observation,
        "clip_mean_sd" if many and not trees else "none_tree_or_clean",
        [keep, clip, isolation],
        evidence,
    )


def _keep_reason(many: list[str], family: str | None) -> str:
    if family == "tree_ensemble":
        return (
            "Only tree models are downstream. They split on rank order, so outliers do not "
            "pull them."
        )
    if not many:
        return "Few values fall outside the IQR fences: keep them as they are."
    if family in (None, "mixed"):
        return f"Keeps every value; outliers pull linear models. {unknown_family(family)}"
    return f"Keeps every value; outliers will pull the {family} model downstream."
