"""Whether a step clips outliers, from the models downstream and the train rows' measured
outlier shares (ADR-0042). Trees split on rank order, so outliers do not pull them."""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    decision,
    flow_evidence,
    flow_fact,
    measured,
    not_applicable,
    profile_evidence,
    step_columns,
)

FAMILY = "flow.model_family"
# What outliers pull, by the family downstream; mixed always includes a family that is not trees.
PULLED = {
    "linear": "extreme values pull the linear model's coefficients.",
    "distance_based": "extreme values stretch the distances the clustering uses.",
    "mixed": "extreme values pull the models downstream that are not trees.",
}


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    family = flow_fact(observation, FAMILY)
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
        "clip_iqr_fence",
        f"{', '.join(many)} has many values outside the IQR fences. The fences come from the "
        "train quartiles, which those values barely move."
        if many
        else "Available; few values would change.",
        {"columns": columns, "k": s["clip_k"]},
    )
    isolation = not_applicable(
        "isolation_forest_filter", "No isolation forest filter operator exists."
    )

    evidence = flow_evidence(observation, [FAMILY])
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in share.items()]
    return decision(
        observation,
        "clip_iqr_fence" if many and not trees else "none_tree_or_clean",
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
    if family is None:
        return "Keeps every value. Whether outliers matter is unclear: no model is downstream yet."
    return f"Keeps every value, but {PULLED[family]}"
