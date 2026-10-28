"""Does each split step split the way the question's confirmed facts or bindings require? (ADR-0042)

It began as the verification half of the retired data split rule. The split_method method now
decides the split, and this check stays as the gate that catches a split built wrong by any route.
It reads settings, not rows: a pass is partial coverage until a run checks the rows.
"""

from collections.abc import Callable, Mapping
from typing import Any

from sprisk_contracts import (
    MethodologyCheck,
    MethodologyDecision,
    MethodologyDecisionByMethod,
    MethodologyDecisionByRule,
    Operator,
    PipelineVersion,
    QuestionVersion,
)
from sprisk_contracts.generated.models import (
    MethodologyCoverage,
    MethodologyPhase,
    Node,
    SplitFolds,
    Verdict,
)
from sprisk_supervised.question_columns import (
    EVENT_TIME,
    ITEM_IDENTITY,
    authoritative,
    bound_column,
)
from sprisk_supervised.split_leakage import CheckInputError, is_split, operators_by_node

CHECK = "methodology.supervised.split_design@1.0.0"
LIMITATIONS = (
    "Compares the split's settings with the question's facts. It does not read rows, so it "
    "cannot show that test rows come later or share no entity with train rows, and it does "
    "not check stratification."
)


def split_design(
    pipeline: PipelineVersion,
    operators: Mapping[str, Operator],
    question: QuestionVersion | None,
    decisions: list[MethodologyDecision],
    new_id: Callable[[], str],
    now: str,
) -> list[MethodologyCheck]:
    """One check per split step; one not-assessed check when there is no split."""
    # A split is found by its role and judged by the folds it declares (ADR-0064).
    op_of = operators_by_node(pipeline, operators)
    folds_of = {n: op.folds for n, op in op_of.items() if is_split(op)}
    splits = [n for n in pipeline.nodes if n.id.root in folds_of]
    if not splits:
        return [_result(pipeline, new_id(), now, Verdict.not_assessed, "No split step.", None)]
    sent = {d.root.id.root: d.root for d in decisions}
    results = []
    for node in splits:
        decision = _method_decision(node, sent)
        verdict, rationale = _judge(node, folds_of[node.id.root], question, decision)
        results.append(_result(pipeline, new_id(), now, verdict, rationale, node, decision))
    return results


def _method_decision(
    node: Node, sent: Mapping[str, MethodologyDecisionByRule | MethodologyDecisionByMethod]
) -> MethodologyDecisionByMethod | None:
    """The method decision `node` cites. No rule decides a split any more (ADR-0063 slice 6),
    so citing a rule's decision, or one that was not sent, is bad input: the check would credit
    the split to the wrong choice."""
    cited = node.methodology_decision_id
    if cited is None:
        return None
    decision = sent.get(cited.root)
    if not isinstance(decision, MethodologyDecisionByMethod):
        raise CheckInputError(
            f"split {node.id.root} cites decision {cited.root}, which was not sent or is not "
            "a method's decision"
        )
    return decision


def _left_to_promises(node: Node, decision: MethodologyDecisionByMethod) -> str:
    """A method may split by a column it bound, which the question does not name, so only
    the method's promises can say whether the rows keep its rule."""
    promises = ", ".join(p.root for p in decision.promises or []) or "none"
    return (
        f"Step {node.id.root} splits as decision {decision.id.root} chose ({decision.option.root} "
        f"of {decision.method.root}). The question names no time or item column to compare it "
        f"with; the method's promises check the rows: {promises}."
    )


def _judge(
    node: Node,
    folds: SplitFolds | None,
    question: QuestionVersion | None,
    by_method: MethodologyDecisionByMethod | None,
) -> tuple[Verdict, str]:
    step = node.id.root
    if question is None:
        return Verdict.not_assessed, (
            f"No question is linked, so step {step} has no time or entity fact to follow."
        )
    params: Mapping[str, Any] = node.params.model_extra or {}
    time = bound_column(question, EVENT_TIME, question.time_column)
    entity = bound_column(question, ITEM_IDENTITY, question.entity_column)
    if time:
        if folds == SplitFolds.time and params.get("time_column") == time:
            if entity and params.get("group_column") != entity:
                return Verdict.fail, (
                    f"Step {step} orders rows by {time}, but the question also names "
                    f"{entity} as the entity column. Set group_column to {entity}, so train "
                    f"drops every {entity} that is also in test."
                )
            purged = f" and no {entity} is in both" if entity else ""
            return Verdict.pass_, (
                f"Step {step} puts the latest rows by {time}, the question's time column, in "
                f"test{purged}."
            )
        return Verdict.fail, (
            f"The question names {time} as the time column, but step {step} "
            f"{_describe(folds, params)}. Use a temporal split on {time}, so the model is "
            "tested on rows later than the ones it learned from."
        )
    if entity:
        if folds == SplitFolds.group and params.get("group_column") == entity:
            return Verdict.pass_, (
                f"Step {step} keeps each {entity}, the question's entity column, wholly in "
                "train or in test."
            )
        return Verdict.fail, (
            f"The question names {entity} as the entity column, but step {step} "
            f"{_describe(folds, params)}. Use a group split on {entity}, so no entity's rows "
            "are both learned from and tested on."
        )
    facts = (question.time_column, question.entity_column)
    unconfirmed = [f.value for f in facts if f is not None and authoritative(f) is None]
    if unconfirmed:
        return Verdict.not_assessed, (
            f"Confirm whether {' and '.join(unconfirmed)} orders or groups the rows. Until "
            f"then step {step} cannot be checked against it."
        )
    if by_method is not None:
        return Verdict.not_assessed, _left_to_promises(node, by_method)
    return Verdict.pass_, (
        f"The question has no time or entity column, so step {step} may split rows freely."
    )


def _describe(folds: SplitFolds | None, params: Mapping[str, Any]) -> str:
    if folds == SplitFolds.time:
        return f"orders rows by {params.get('time_column')}"
    if folds == SplitFolds.group:
        return f"groups rows by {params.get('group_column')}"
    return "shuffles rows at random"


def _result(
    pipeline: PipelineVersion,
    check_id: str,
    now: str,
    verdict: Verdict,
    rationale: str,
    node: Node | None,
    decision: MethodologyDecisionByMethod | None = None,
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
