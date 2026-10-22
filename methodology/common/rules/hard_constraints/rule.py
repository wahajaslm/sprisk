"""Whether the question states how interpretable its model must be (ADR-0059).

Only a person knows how the model will be used. The level (high, medium, low) is asked for on
the model step, before a model is chosen; the interpretability rule and the shortlist act on
it. Silence is not "no constraint", so a missing level asks.
"""

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.rule import applicable, decision, needs_fact, question_evidence


def decide(observation: RuleObservation) -> RuleDecision:
    evidence = question_evidence(observation, {"question.interpretability": "Interpretability"})
    level = observation.facts.get("question.interpretability")
    if level is None:
        ask = needs_fact(
            "stated",
            "State how far a person must follow each prediction: high (only models a person "
            "can read), medium or low.",
        )
        return decision(observation, "stated", [ask], evidence)
    return decision(
        observation,
        "stated",
        [applicable("stated", f"Interpretability must be {level.value}.", {})],
        evidence,
    )
