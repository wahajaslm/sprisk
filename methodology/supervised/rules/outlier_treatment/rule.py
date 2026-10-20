"""Whether a step clips outliers, from the models downstream and the train rows' measured
outlier shares (ADR-0042). Trees split on rank order, so outlying features do not pull them,
and DBSCAN marks isolated rows as noise. The target is never clipped: that changes labels."""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    flow_evidence,
    flow_fact,
    measured,
    needs_fact,
    not_applicable,
    profile_evidence,
    question_evidence,
    step_columns,
)

FAMILY = "flow.model_family"
# Families whose fit outlying features do not pull, and why.
UNPULLED = {
    "tree_ensemble": "Only tree models are downstream. They split on rank order, so outlying "
    "feature values do not pull them.",
    "density_based": "DBSCAN downstream marks isolated rows as noise. Clipping would pile them "
    "onto the fence, where they can form a false cluster.",
    "featureless": "The only models downstream ignore their features, such as a dummy baseline.",
}
# What outliers pull, by the family downstream; mixed always includes a family that is not trees.
PULLED = {
    "linear": "extreme values pull the linear model's coefficients.",
    "distance_based": "extreme values pull the cluster centres and spreads.",
    "mixed": "extreme values pull the models downstream that are not trees.",
    "unknown": "a model sits behind a step this rule cannot see, so they may pull it.",
}


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    family = flow_fact(observation, FAMILY)
    target_fact = observation.facts.get("question.target")
    target = authoritative(target_fact)
    # An inferred target only asks: it cannot clear a column for clipping, nor protect it.
    maybe_target = target_fact.value if target_fact and target is None else None
    task = authoritative(observation.facts.get("question.task"))
    columns = step_columns(observation)
    features = [c for c in columns if c != target]
    # A column without an outlier share has no variation, so it has no outliers to clip.
    share = {c: v for c in columns if (v := measured(observation, c, "outlier_share")) is not None}
    threshold = s["outlier_fraction_threshold"]
    many = [c for c in features if share.get(c, 0.0) >= threshold]
    target_outliers = target in columns and share.get(target, 0.0) >= threshold
    unpulled = UNPULLED.get(family or "")

    keep_reason = _keep_reason(many, family, unpulled)
    if target_outliers and task == "regression":
        keep_reason += (
            f" {target} is the target: its outliers pull squared-error fits, trees included, "
            "but clipping it would change the labels."
        )
    # Keeping the step as it is changes no graph, so this choice has no params.
    keep = {"id": "none_tree_or_clean", "applicability": "applicable", "reason": keep_reason}
    if maybe_target in columns:
        clip = needs_fact(
            "clip_iqr_fence",
            f"Confirm the target first: if {maybe_target} is the target, clipping it would change "
            "the labels the model is scored on.",
        )
    else:
        clip = _clip(features, many, target if target in columns else None, s["clip_k"])
    isolation = not_applicable(
        "isolation_forest_filter", "No isolation forest filter operator exists."
    )

    evidence = flow_evidence(observation, [FAMILY])
    if target_fact and target_fact.value in columns:
        evidence += question_evidence(
            observation, {"question.target": "Target", "question.task": "Task"}
        )
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in share.items()]
    return decision(
        observation,
        "clip_iqr_fence"
        if many and not unpulled and maybe_target not in columns
        else "none_tree_or_clean",
        [keep, clip, isolation],
        evidence,
    )


def _keep_reason(many: list[str], family: str | None, unpulled: str | None) -> str:
    if unpulled:
        return unpulled
    if not many:
        return "Few values fall outside the IQR fences: keep them as they are."
    if family is None:
        return "Keeps every value. Whether outliers matter is unclear: no model is downstream yet."
    return f"Keeps every value, but {PULLED[family]}"


def _clip(features: list[str], many: list[str], target: str | None, k: float) -> dict[str, Any]:
    if not features:
        return not_applicable(
            "clip_iqr_fence",
            f"{target} is the target: clipping it would change the labels the model is "
            "scored on, test ones included.",
        )
    reason = (
        f"{', '.join(many)} has many values outside the IQR fences. The fences come from the "
        "train quartiles, which those values barely move."
        if many
        else "Available; few values would change."
    )
    if target:
        reason += f" {target} is the target, so it is left as it is."
    return applicable("clip_iqr_fence", reason, {"columns": features, "k": k})
