"""Which registered models are worth comparing for this question (ADR-0044).

Never one winner: cross-validation on the train rows decides. The dummy baseline is always on
the list as the floor. Few rows favour low-variance models, so a forest needs enough rows.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    is_numeric,
    profile_evidence,
    required,
    shortlist_decision,
    step_columns,
)

PREFIX, SUFFIX = "candidate.", ".family"


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    rows = int(observation.profile["rows"])
    columns = step_columns(observation)
    text = [c for c in columns if not is_numeric(observation, c)]
    text_share = len(text) / len(columns) if columns else 0.0
    missing = max((required(observation, c, "missing_share") for c in columns), default=0.0)

    shortlist: list[str] = []
    alternatives: list[dict[str, Any]] = []
    for id, family in sorted(_candidates(observation).items()):
        on_list, reason = _consider(family, rows, text, text_share, s)
        if on_list:
            shortlist.append(id)
        # Every candidate can still be chosen; choosing one off the list needs a reason.
        alternatives.append(applicable(id, reason, {}))

    evidence = [
        profile_evidence("Train rows", str(rows)),
        profile_evidence("Text feature columns", f"{len(text)} of {len(columns)}"),
        profile_evidence("Largest missing share", f"{missing:.1%}"),
    ]
    return shortlist_decision(observation, shortlist, alternatives, evidence)


def _candidates(observation: RuleObservation) -> dict[str, str]:
    """Candidate id to family, from the candidate.<id>.family facts Rust sends."""
    return {
        name[len(PREFIX) : -len(SUFFIX)]: fact.value
        for name, fact in observation.facts.items()
        if name.startswith(PREFIX) and name.endswith(SUFFIX)
    }


def _consider(
    family: str, rows: int, text: list[str], text_share: float, s: dict[str, Any]
) -> tuple[bool, str]:
    if family == "featureless":
        return True, (
            "The floor every model must beat: it ignores the features and predicts the most "
            "frequent class or the mean (scikit-learn, Dummy estimators)."
        )
    if family == "linear":
        return True, (
            f"A low-variance model, safest with {rows} train rows: simpler models overfit less "
            "(Hastie et al., ESL §2.9)."
        )
    if family == "tree_ensemble":
        if rows < s["min_rows_for_forest"]:
            return False, (
                f"Left off: {rows} train rows are below {s['min_rows_for_forest']}, too few to "
                "trust a forest's variance (Hastie et al., ESL §2.9)."
            )
        why = f"With {rows} train rows a forest can learn interactions a linear model misses"
        if text_share >= s["text_share_threshold"]:
            why += f", and trees split on encoded text columns ({', '.join(text)}) directly"
        return True, why + " (Breiman 2001; Hastie et al., ESL ch. 15)."
    return True, f"No heuristic for {family} models yet, so cross-validation decides."
