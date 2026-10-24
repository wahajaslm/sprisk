"""Does each split step split the way the question's confirmed facts require? (ADR-0042)

It began as the verification half of the data split rule and keeps that rule's check id, so
stored checks stay comparable. The split is now decided by the split_method method, whose
promises replace this check when the old rules go (ADR-0063 slice 6).
It reads settings, not rows: a pass is partial coverage until a run checks the rows.
"""

from collections.abc import Callable, Mapping
from typing import Any

from sprisk_contracts import MethodologyCheck, MethodologyDecision, PipelineVersion, QuestionVersion
from sprisk_contracts.generated.models import (
    MethodologyCoverage,
    MethodologyPhase,
    Node,
    Verdict,
)
from sprisk_supervised.split_leakage import HOLDOUT_PORTS, CheckInputError, unversioned
from sprisk_workers.rule import authoritative

CHECK = "methodology.supervised.data_split@1.0.0"
RANDOM = "sprisk.validation.random_split"
TEMPORAL = "sprisk.validation.temporal_split"
GROUP = "sprisk.validation.group_split"
# The operator each alternative of the retired data_split rule built, for the decisions it made.
ALTERNATIVE_OPERATORS = {
    "temporal": TEMPORAL,
    "entity_group": GROUP,
    "stratified_random": RANDOM,
    "simple_random": RANDOM,
}
LIMITATIONS = (
    "Compares the split's settings with the question's facts. It does not read rows, so it "
    "cannot show that test rows come later or share no entity with train rows, and it does "
    "not check stratification."
)


def split_design(
    pipeline: PipelineVersion,
    question: QuestionVersion | None,
    decisions: list[MethodologyDecision],
    new_id: Callable[[], str],
    now: str,
) -> list[MethodologyCheck]:
    """One check per split step; one not-assessed check when there is no split."""
    splits = [n for n in pipeline.nodes if unversioned(n.operator.root) in HOLDOUT_PORTS]
    if not splits:
        return [_result(pipeline, new_id(), now, Verdict.not_assessed, "No split step.", None)]
    sent = {d.id.root: d for d in decisions}
    results = []
    for node in splits:
        decision = _own_decision(node, sent)
        verdict, rationale = _judge(node, question)
        if decision is not None and verdict != Verdict.not_assessed:
            drift = _drift(node, decision)
            if drift:
                verdict, rationale = Verdict.fail, drift
        results.append(_result(pipeline, new_id(), now, verdict, rationale, node, decision))
    return results


def _own_decision(
    node: Node, sent: Mapping[str, MethodologyDecision]
) -> MethodologyDecision | None:
    """The split decision `node` cites. Citing one that was not sent, or that decided
    something else, is bad input: the check would credit the split to the wrong choice."""
    cited = node.methodology_decision_id
    if cited is None:
        return None
    decision = sent.get(cited.root)
    if decision is None or decision.rule.root != CHECK or decision.subject_node_id != node.id:
        raise CheckInputError(
            f"split {node.id.root} cites decision {cited.root}, which was not sent or is not "
            f"a {CHECK} decision about this step"
        )
    return decision


def _drift(node: Node, decision: MethodologyDecision) -> str | None:
    """Why the step no longer matches the alternative its decision chose, or None."""
    chose = decision.alternative_id
    if ALTERNATIVE_OPERATORS.get(chose) == unversioned(node.operator.root):
        return None
    return (
        f"Step {node.id.root} cites decision {decision.id.root}, which chose {chose}, but the "
        "step was changed since. Apply the decision again or make a new one."
    )


def _judge(node: Node, question: QuestionVersion | None) -> tuple[Verdict, str]:
    step = node.id.root
    if question is None:
        return Verdict.not_assessed, (
            f"No question is linked, so step {step} has no time or entity fact to follow."
        )
    params: Mapping[str, Any] = node.params.model_extra or {}
    operator = unversioned(node.operator.root)
    time = authoritative(question.time_column)
    entity = authoritative(question.entity_column)
    if time:
        if operator == TEMPORAL and params.get("time_column") == time:
            if entity and params.get("group_column") != entity:
                return Verdict.fail, (
                    f"Step {step} orders rows by {time}, but the question also confirms "
                    f"{entity} as the entity column. Set group_column to {entity}, so train "
                    f"drops every {entity} that is also in test."
                )
            purged = f" and no {entity} is in both" if entity else ""
            return Verdict.pass_, (
                f"Step {step} puts the latest rows by {time}, the confirmed time column, in "
                f"test{purged}."
            )
        return Verdict.fail, (
            f"The question confirms {time} as the time column, but step {step} "
            f"{_describe(operator, params)}. Use a temporal split on {time}, so the model is "
            "tested on rows later than the ones it learned from."
        )
    if entity:
        if operator == GROUP and params.get("group_column") == entity:
            return Verdict.pass_, (
                f"Step {step} keeps each {entity}, the confirmed entity column, wholly in "
                "train or in test."
            )
        return Verdict.fail, (
            f"The question confirms {entity} as the entity column, but step {step} "
            f"{_describe(operator, params)}. Use a group split on {entity}, so no entity's rows "
            "are both learned from and tested on."
        )
    facts = (question.time_column, question.entity_column)
    unconfirmed = [f.value for f in facts if f is not None and authoritative(f) is None]
    if unconfirmed:
        return Verdict.not_assessed, (
            f"Confirm whether {' and '.join(unconfirmed)} orders or groups the rows. Until "
            f"then step {step} cannot be checked against it."
        )
    return Verdict.pass_, (
        f"The question has no time or entity column, so step {step} may split rows freely."
    )


def _describe(operator: str, params: Mapping[str, Any]) -> str:
    if operator == TEMPORAL:
        return f"orders rows by {params.get('time_column')}"
    if operator == GROUP:
        return f"groups rows by {params.get('group_column')}"
    return "shuffles rows at random"


def _result(
    pipeline: PipelineVersion,
    check_id: str,
    now: str,
    verdict: Verdict,
    rationale: str,
    node: Node | None,
    decision: MethodologyDecision | None = None,
) -> MethodologyCheck:
    coverage = {
        Verdict.pass_: MethodologyCoverage.partial,
        Verdict.fail: MethodologyCoverage.complete,
        Verdict.not_assessed: MethodologyCoverage.not_assessed,
    }[verdict]
    raw: dict[str, Any] = {
        "schema_version": "sprisk.methodology_check/v1",
        "id": check_id,
        "pipeline_version_id": pipeline.id.root,
        "check": CHECK,
        "phase": MethodologyPhase.plan,
        "coverage": coverage,
        "verdict": verdict,
        "rationale": rationale,
        "cited_nodes": [] if node is None else [node.id.root],
        "limitations": LIMITATIONS,
        "created_at": now,
    }
    if decision is not None:
        raw["methodology_decision_id"] = decision.id.root
    return MethodologyCheck.model_validate(raw)
