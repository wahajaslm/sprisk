"""Does each split step split the way the question's confirmed facts require? (ADR-0042)

This is the verification half of the data split rule, so it carries that rule's identity.
It reads settings, not rows: a pass is partial coverage until a run checks the rows.
"""

from collections.abc import Callable, Mapping
from typing import Any

from sprisk_contracts import MethodologyCheck, MethodologyDecision, PipelineVersion, QuestionVersion
from sprisk_contracts.generated.models import MethodologyCoverage, MethodologyPhase, Node, Verdict
from sprisk_supervised.split_leakage import HOLDOUT_PORTS, unversioned
from sprisk_workers.rule import authoritative

CHECK = "methodology.supervised.data_split@1.0.0"
TEMPORAL = "sprisk.validation.temporal_split"
GROUP = "sprisk.validation.group_split"
LIMITATIONS = (
    "Compares the split's settings with the question's facts. It does not read rows, so it "
    "cannot show that test rows come later or share no entity with train rows."
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
    chose = {d.id.root: d for d in decisions if d.rule.root == CHECK}
    results = []
    for node in splits:
        verdict, rationale = _judge(node, question)
        decided = node.methodology_decision_id
        decision = chose.get(decided.root) if decided else None
        results.append(_result(pipeline, new_id(), now, verdict, rationale, node, decision))
    return results


def _judge(node: Node, question: QuestionVersion | None) -> tuple[Verdict, str]:
    step = node.id.root
    if question is None:
        return Verdict.not_assessed, (
            f"No question is linked, so step {step} has no time or entity fact to follow."
        )
    params: Mapping[str, Any] = node.params.model_extra or {}
    time = authoritative(question.time_column)
    entity = authoritative(question.entity_column)
    if time:
        if unversioned(node.operator.root) == TEMPORAL and params.get("time_column") == time:
            return Verdict.pass_, (
                f"Step {step} puts the latest rows by {time}, the confirmed time column, in test."
            )
        return Verdict.fail, (
            f"The question confirms {time} as the time column, but step {step} "
            f"{_describe(node, params)}. Use a temporal split on {time}, so the model is "
            "tested on rows later than the ones it learned from."
        )
    if entity:
        if unversioned(node.operator.root) == GROUP and params.get("group_column") == entity:
            return Verdict.pass_, (
                f"Step {step} keeps each {entity}, the confirmed entity column, wholly in "
                "train or in test."
            )
        return Verdict.fail, (
            f"The question confirms {entity} as the entity column, but step {step} "
            f"{_describe(node, params)}. Use a group split on {entity}, so no entity's rows "
            "are both learned from and tested on."
        )
    return Verdict.pass_, (
        f"The question confirms no time or entity column, so step {step} may split rows freely."
    )


def _describe(node: Node, params: Mapping[str, Any]) -> str:
    operator = unversioned(node.operator.root)
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
