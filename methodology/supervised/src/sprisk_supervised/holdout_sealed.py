from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import networkx as nx

from sprisk_contracts import MethodologyCheck, Operator, PipelineVersion
from sprisk_contracts.generated.models import CapabilityClass, PortKind, Verdict

CHECK = "supervised.holdout_sealed@1.0.0"

# Vertices: node ids and their output ports ("node.port").
type PortGraph = nx.DiGraph[Any]

# Pack settings (ADR-0015). Baseline models are reference points, not candidates.
# Holdout ports are the sealed test outputs; other split outputs may be used for selection.
BASELINE_OPERATORS = frozenset({"sprisk.ml.dummy_baseline"})
HOLDOUT_PORTS = {
    "sprisk.validation.random_split": "test",
    "sprisk.validation.temporal_split": "test",
}

LIMITATIONS = (
    "Checks one pipeline version only; selection across versions that reuse the same "
    "split is not detected."
)


class CheckInputError(ValueError):
    """The pipeline is not one Gate A would accept, so the rule cannot run."""


def holdout_sealed(
    pipeline: PipelineVersion, operators: Mapping[str, Operator], check_id: str, now: str
) -> MethodologyCheck:
    """FAIL when a holdout is used to fit or to choose between models (ADR-0015, §15.11).

    - Any estimator downstream of a holdout port was fit on it.
    - Per holdout, evaluators may score at most one non-baseline model, where a
      model is the nearest estimator upstream of the evaluator's model input.
    """
    op_of = _operators_by_node(pipeline, operators)
    graph = _port_graph(pipeline, op_of)
    holdouts = {
        f"{node}.{HOLDOUT_PORTS[_unversioned(op)]}"
        for node, op in op_of.items()
        if _unversioned(op) in HOLDOUT_PORTS
    }

    for node in sorted(op_of):
        if op_of[node].capability_class == CapabilityClass.estimator:
            fitted_on = sorted(holdouts & nx.ancestors(graph, node))
            if fitted_on:
                rationale = f"{node} is fit on data derived from holdout {fitted_on[0]}."
                cited = [node, fitted_on[0].split(".")[0]]
                return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)

    evaluators = sorted(
        n for n, op in op_of.items() if op.capability_class == CapabilityClass.evaluator
    )
    if not evaluators:
        return _result(pipeline, check_id, now, Verdict.not_assessed, "No evaluator nodes.", [])

    candidates: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for evaluator in evaluators:
        table, model = _input_sources(evaluator, op_of[evaluator], graph)
        scored = holdouts & (nx.ancestors(graph, table) | {table})
        for model_node in _nearest_estimators(graph, model, op_of):
            if _unversioned(op_of[model_node]) in BASELINE_OPERATORS:
                continue
            for holdout in scored:
                candidates[holdout][model_node].add(evaluator)

    for holdout, models in sorted(candidates.items()):
        if len(models) > 1:
            cited = sorted({holdout.split(".")[0], *(e for evs in models.values() for e in evs)})
            rationale = (
                f"Holdout {holdout} scores {len(models)} non-baseline models "
                f"({', '.join(sorted(models))}); choosing between them uses the holdout."
            )
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)

    examined = sorted({*evaluators, *(h.split(".")[0] for h in holdouts)})
    rationale = (
        f"Examined evaluators {', '.join(evaluators)} against holdouts "
        f"{', '.join(sorted(holdouts)) or 'none'}: each holdout scores at most one "
        "non-baseline model, and no estimator is fit on a holdout."
    )
    return _result(pipeline, check_id, now, Verdict.pass_, rationale, examined)


def _unversioned(op: Operator) -> str:
    return op.id.root.split("@")[0]


def _operators_by_node(
    pipeline: PipelineVersion, operators: Mapping[str, Operator]
) -> dict[str, Operator]:
    op_of = {}
    for node in pipeline.nodes:
        op = operators.get(node.operator.root)
        if op is None:
            raise CheckInputError(f"node {node.id.root}: unknown operator {node.operator.root}")
        op_of[node.id.root] = op
    return op_of


def _port_graph(pipeline: PipelineVersion, op_of: Mapping[str, Operator]) -> PortGraph:
    """Vertices are nodes and their output ports: node → node.port → consumer node."""
    graph: PortGraph = nx.DiGraph()
    for node, op in op_of.items():
        graph.add_node(node)
        for port in op.outputs:
            graph.add_edge(node, f"{node}.{port.name.root}")
    for edge in pipeline.edges:
        consumer, in_port = edge.to.root.split(".")
        graph.add_edge(edge.from_.root, consumer)
        graph.edges[edge.from_.root, consumer].setdefault("ports", set()).add(in_port)
    return graph


def _input_sources(evaluator: str, op: Operator, graph: PortGraph) -> tuple[str, str]:
    """The upstream output ports feeding the evaluator's one table and one model input."""
    sources: dict[PortKind, list[str]] = defaultdict(list)
    unconnected = []
    for port in op.inputs:
        name = port.name.root
        upstream = [
            src for src in graph.predecessors(evaluator) if _feeds(graph, src, evaluator, name)
        ]
        if not upstream:
            unconnected.append(f"{evaluator}.{name}")
        sources[port.kind] += upstream
    if unconnected:
        raise CheckInputError(f"inputs not connected: {', '.join(unconnected)}")
    for kind in (PortKind.table, PortKind.model):
        if len(sources[kind]) != 1:
            raise CheckInputError(
                f"evaluator {evaluator} needs exactly one {kind} input, has {len(sources[kind])}"
            )
    return sources[PortKind.table][0], sources[PortKind.model][0]


def _feeds(graph: PortGraph, src: str, node: str, port: str) -> bool:
    return port in graph.edges[src, node].get("ports", set())


def _nearest_estimators(graph: PortGraph, port: str, op_of: Mapping[str, Operator]) -> set[str]:
    node = port.split(".")[0]
    if op_of[node].capability_class == CapabilityClass.estimator:
        return {node}
    return {
        est for src in graph.predecessors(node) for est in _nearest_estimators(graph, src, op_of)
    }


def _result(
    pipeline: PipelineVersion,
    check_id: str,
    now: str,
    verdict: Verdict,
    rationale: str,
    cited: list[str],
) -> MethodologyCheck:
    return MethodologyCheck.model_validate(
        {
            "schema_version": "sprisk.methodology_check/v1",
            "id": check_id,
            "pipeline_version_id": pipeline.id.root,
            "check": CHECK,
            "verdict": verdict,
            "rationale": rationale,
            "cited_nodes": cited,
            "limitations": LIMITATIONS,
            "created_at": now,
        }
    )
