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
    model_families,
    needs_fact,
    not_applicable,
    profile_evidence,
    question_evidence,
    step_columns,
)

FAMILIES = "flow.model_families"
HIDDEN = "flow.models_hidden"
# Families whose fit outlying features do not pull, and why.
UNPULLED = {
    "tree_ensemble": "Trees split on rank order, so outlying feature values do not pull them.",
    "density_based": "DBSCAN marks isolated rows as noise. Clipping would pile them onto the "
    "fence, where they can form a false cluster.",
    "featureless": "The only models downstream ignore their features, such as a dummy baseline.",
}
# What outliers pull, by family.
PULLED = {
    "linear": "extreme values pull the linear model's coefficients",
    "distance_based": "extreme values pull the cluster centres and spreads",
}
BEHIND = "outliers may pull a model that sits behind another step or model downstream"


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    families = model_families(observation)
    hidden = flow_fact(observation, HIDDEN)
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
    iqr = {c: measured(observation, c, "iqr") for c in features}
    # With Q1 = Q3 the fences meet, so a clip would flatten the column; the step refuses it.
    flat = [c for c in features if iqr[c] == 0]
    clippable = [c for c in features if iqr[c]]
    many = [c for c in clippable if share.get(c, 0.0) >= threshold]
    target_outliers = target in columns and share.get(target, 0.0) >= threshold
    # Every model is seen and none is pulled by outlying features.
    unpulled = hidden == "none" and bool(families) and families <= UNPULLED.keys()

    flat_flagged = [c for c in flat if share.get(c, 0.0) >= threshold]
    keep_reason = _keep_reason(many, flat_flagged, families, hidden, unpulled)
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
        clip = _clip(clippable, many, flat, target if target in columns else None, s["clip_k"])
        if "density_based" in families and clip["applicability"] == "applicable":
            clip["reason"] += f" Caution: {UNPULLED['density_based']}"
    isolation = not_applicable(
        "isolation_forest_filter", "No isolation forest filter operator exists."
    )

    evidence = flow_evidence(observation, [FAMILIES, HIDDEN])
    if target_fact and target_fact.value in columns:
        weighed = {"question.target": "Target"}
        if target_outliers:
            weighed["question.task"] = "Task"
        evidence += question_evidence(observation, weighed)
    evidence += [profile_evidence(f"{c} outlier share", f"{v:.1%}") for c, v in share.items()]
    evidence += [profile_evidence(f"{c} IQR", "0") for c in flat]
    return decision(
        observation,
        "clip_iqr_fence"
        if many and not unpulled and maybe_target not in columns
        else "none_tree_or_clean",
        [keep, clip, isolation],
        evidence,
    )


def _keep_reason(
    many: list[str], flat_flagged: list[str], families: set[str], hidden: str | None, unpulled: bool
) -> str:
    if unpulled:
        return " ".join(UNPULLED[f] for f in sorted(families))
    if not many and flat_flagged:
        return (
            f"Only {', '.join(flat_flagged)} has many values outside the IQR fences, but it has "
            "no IQR spread: most values are equal, so the others are not outliers."
        )
    if not many:
        return "Few values fall outside the IQR fences: keep them as they are."
    if hidden is None:
        return "Keeps every value. Whether outliers matter is unclear: no model is downstream yet."
    pulls = [PULLED[f] for f in sorted(families) if f in PULLED]
    if hidden != "none":
        pulls.append(BEHIND)
    return f"Keeps every value, but {'; '.join(pulls)}."


def _clip(
    clippable: list[str], many: list[str], flat: list[str], target: str | None, k: float
) -> dict[str, Any]:
    left_out = []
    if flat:
        left_out.append(f"{', '.join(flat)} has no IQR spread in train: clipping would flatten it.")
    if target:
        left_out.append(
            f"{target} is the target: clipping it would change the labels the model is "
            "scored on, test ones included."
        )
    if not clippable:
        return not_applicable(
            "clip_iqr_fence", " ".join(left_out) or "No column has a spread to clip."
        )
    reason = (
        f"{', '.join(many)} has many values outside the IQR fences. The fences come from the "
        "train quartiles, which those values barely move."
        if many
        else "Available; few values would change."
    )
    reason = " ".join([reason, *(f"Left out: {why}" for why in left_out)])
    return applicable("clip_iqr_fence", reason, {"columns": clippable, "k": k})
