import json
from collections import defaultdict
from collections.abc import Mapping

from sprisk_contracts import MethodologyCheck, Operator, PipelineVersion
from sprisk_contracts.generated.models import CapabilityClass, PortKind

CHECK = "supervised.holdout_sealed@1.0.0"

# Pack setting (ADR-0015): models from these operators are reference points,
# not candidates, so scoring them next to one model is not a selection.
BASELINE_OPERATORS = frozenset({"sprisk.ml.dummy_baseline"})


def holdout_sealed(
    pipeline: PipelineVersion, operators: Mapping[str, Operator], check_id: str, now: str
) -> MethodologyCheck:
    """FAIL when one test table scores more than one non-baseline model (ADR-0015, §15.11).

    Runs after Gate A, so every operator is known and every input port is connected.
    """
    op_of = {n.id.root: operators[n.operator.root] for n in pipeline.nodes}
    source_of = {e.to.root: e.from_.root for e in pipeline.edges}
    evaluators = sorted(
        n for n, op in op_of.items() if op.capability_class == CapabilityClass.evaluator
    )
    if not evaluators:
        return _result(pipeline, check_id, now, "not_assessed", "No evaluator nodes.", [])

    # scored table port -> {candidate model node: evaluator nodes scoring it}
    candidates: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for evaluator in evaluators:
        table, model = _scored_table_and_model(evaluator, op_of[evaluator], source_of)
        model_node = model.split(".")[0]
        if op_of[model_node].id.root.split("@")[0] not in BASELINE_OPERATORS:
            candidates[table][model_node].append(evaluator)

    for table, models in sorted(candidates.items()):
        if len(models) > 1:
            cited = sorted({table.split(".")[0], *(e for evs in models.values() for e in evs)})
            rationale = (
                f"Test table {table} scores {len(models)} non-baseline models "
                f"({', '.join(sorted(models))}); choosing between them uses the holdout."
            )
            return _result(pipeline, check_id, now, "fail", rationale, cited)
    return _result(
        pipeline,
        check_id,
        now,
        "pass",
        "Each test table scores at most one non-baseline model.",
        [],
    )


def _scored_table_and_model(
    evaluator: str, op: Operator, source_of: Mapping[str, str]
) -> tuple[str, str]:
    """Upstream ports feeding the evaluator's table input and model input."""
    by_kind = {p.kind: source_of[f"{evaluator}.{p.name.root}"] for p in op.inputs}
    return by_kind[PortKind.table], by_kind[PortKind.model]


def _result(
    pipeline: PipelineVersion,
    check_id: str,
    now: str,
    verdict: str,
    rationale: str,
    cited: list[str],
) -> MethodologyCheck:
    return MethodologyCheck.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.methodology_check/v1",
                "id": check_id,
                "pipeline_version_id": pipeline.id.root,
                "check": CHECK,
                "verdict": verdict,
                "rationale": rationale,
                "cited_nodes": cited,
                "created_at": now,
            }
        )
    )
