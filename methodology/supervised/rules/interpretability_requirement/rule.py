"""Whether a forest may stay, given how interpretable the model must be (ADR-0059).

With high interpretability a person must follow each prediction, which a forest does not allow
(Rudin 2019), so it is replaced by a linear model that keeps the forest's target, task, features
and costs. Medium or low leaves it. With no level stated the forest stays; the hard-constraints
rule asks for the level.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import (
    applicable,
    authoritative,
    decision,
    not_applicable,
    question_evidence,
)


def decide(observation: RuleObservation) -> RuleDecision:
    evidence = question_evidence(observation, {"question.interpretability": "Interpretability"})
    level = authoritative(observation.facts.get("question.interpretability"))
    if level == "high":
        why = "Interpretability must be high, and a person cannot follow a forest's prediction."
        swap = applicable("interpretable_only", why, {})
        keep = not_applicable("keep_model", why)
        return decision(observation, "interpretable_only", [keep, swap], evidence)
    why = (
        f"Interpretability is {level}, so a forest may stay."
        if level is not None
        else "No interpretability level is stated yet; the hard-constraints rule asks for it."
    )
    swap = not_applicable("interpretable_only", why)
    return decision(observation, "keep_model", [applicable("keep_model", why, {}), swap], evidence)
