"""Which registered models are worth comparing for this question (ADR-0044).

Never one winner: the candidates are compared on the train rows, and the comparison decides.
The dummy baseline is always on the list as the floor. A forest needs enough rows to be worth
comparing; the threshold is a setting.
"""

from typing import Any

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    profile_evidence,
    shortlist_decision,
    step_columns,
    train_rows,
)

PREFIX, SUFFIX = "candidate.", ".family"


def decide(observation: RuleObservation) -> RuleDecision:
    s = observation.settings
    rows = train_rows(observation)
    shortlist: list[str] = []
    alternatives: list[dict[str, Any]] = []
    for id, family in sorted(_candidates(observation).items()):
        on_list, reason = _consider(family, rows, s)
        if on_list:
            shortlist.append(id)
        # Every candidate can still be chosen; choosing one without comparing needs a reason.
        alternatives.append(applicable(id, reason, {}))

    evidence = [
        profile_evidence("Train rows", str(rows)),
        profile_evidence("Feature columns", str(len(step_columns(observation)))),
    ]
    return shortlist_decision(observation, shortlist, alternatives, evidence)


def _candidates(observation: RuleObservation) -> dict[str, str]:
    """Candidate id to family, from the candidate.<id>.family facts Rust sends."""
    return {
        name[len(PREFIX) : -len(SUFFIX)]: fact.value
        for name, fact in observation.facts.items()
        if name.startswith(PREFIX) and name.endswith(SUFFIX)
    }


def _consider(family: str, rows: int, s: dict[str, Any]) -> tuple[bool, str]:
    if family == "featureless":
        return True, (
            "The floor every model must beat: it ignores the features and predicts the most "
            "frequent class or the mean (scikit-learn, Dummy estimators)."
        )
    if family == "linear":
        return True, (
            "A simple reference model. Comparing it with more flexible models shows the "
            "bias-variance trade-off on these rows (Hastie et al., ESL §2.9)."
        )
    if family == "tree_ensemble":
        if rows < s["min_rows_for_forest"]:
            return False, (
                f"Left off: {rows} train rows are below sprisk's default of "
                f"{s['min_rows_for_forest']} for a forest, so the simpler models are compared "
                "first. It can still be chosen with a reason."
            )
        return True, (
            f"With {rows} train rows a forest can learn interactions a linear model misses "
            "(Breiman 2001; Hastie et al., ESL ch. 15)."
        )
    return True, f"No heuristic for {family} models yet, so it is put forward to be compared."
