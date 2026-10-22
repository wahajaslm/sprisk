from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import networkx as nx

from sprisk_contracts import MethodologyCheck, Operator, PipelineVersion
from sprisk_contracts.generated.models import CapabilityClass, PortKind, Verdict

CHECK = "supervised.split_leakage@1.0.0"

# Vertices: node ids and their output ports ("node.port").
type PortGraph = nx.DiGraph[Any]

# Pack settings (ADR-0015). Baseline models are reference points, not candidates.
# Holdout ports are the sealed test outputs; other split outputs may be used for selection.
BASELINE_OPERATORS = frozenset({"sprisk.ml.dummy_baseline"})
HOLDOUT_PORTS = {
    "sprisk.validation.random_split": "test",
    "sprisk.validation.temporal_split": "test",
    "sprisk.validation.group_split": "test",
}
TRAIN_PORT = "train"
# Transforms that learn from their `train` input and apply to `train` and `test` (ADR-0018).
FITTING_TRANSFORMS = frozenset(
    {
        "sprisk.clean.impute",
        "sprisk.clean.scale",
        "sprisk.clean.encode",
        "sprisk.clean.group_rare",
        "sprisk.clean.clip_outliers",
        "sprisk.clean.spectral_gating",
    }
)

LIMITATIONS = (
    "Looks at this version of the flow only. If earlier versions compared models on the "
    "same test set, this check cannot see it."
)


class CheckInputError(ValueError):
    """The pipeline is not one Gate A would accept, so the rule cannot run."""


def split_leakage(
    pipeline: PipelineVersion, operators: Mapping[str, Operator], check_id: str, now: str
) -> MethodologyCheck:
    """FAIL when a holdout is used to fit or to choose between models (ADR-0015, §15.11).

    - A fitting transform must learn from a split's train rows, never unsplit data or a holdout.
    - Any estimator downstream of a holdout port was fit on it.
    - When the flow has a split, an estimator that reaches a data source other than through a
      split's train port was fit on rows that include the holdout.
    - Per holdout, evaluators may score at most one non-baseline model, where a
      model is the nearest estimator upstream of the evaluator's model input.
    """
    op_of = _operators_by_node(pipeline, operators)
    graph = _port_graph(pipeline, op_of)
    holdouts = {
        f"{node}.{HOLDOUT_PORTS[unversioned(op.id.root)]}"
        for node, op in op_of.items()
        if unversioned(op.id.root) in HOLDOUT_PORTS
    }

    splits = [n for n, op in op_of.items() if unversioned(op.id.root) in HOLDOUT_PORTS]
    sources = {n for n, op in op_of.items() if op.capability_class == CapabilityClass.source}
    # Cut every split's train port; any data source still reachable bypassed the split.
    cut = graph.copy()
    cut.remove_nodes_from(f"{s}.{TRAIN_PORT}" for s in splits)
    for node in sorted(
        n for n, op in op_of.items() if unversioned(op.id.root) in FITTING_TRANSFORMS
    ):
        problem = _fit_problem(graph, cut, node, splits, sources, holdouts)
        if problem:
            rationale, cited = problem
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)

    estimators = sorted(
        n for n, op in op_of.items() if op.capability_class == CapabilityClass.estimator
    )
    # Only a source a split reads holds test rows; another dataset is not this split's.
    split_sources = sources & {a for s in splits for a in nx.ancestors(graph, s)}
    for node in estimators:
        fitted_on = sorted(holdouts & nx.ancestors(graph, node))
        if fitted_on:
            rationale = (
                f"{node} learns from the test set ({fitted_on[0]}). "
                "A model may only learn from training rows."
            )
            cited = [node, fitted_on[0].split(".")[0]]
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)
        unsplit = sorted(p for p in nx.ancestors(cut, node) if p.split(".")[0] in split_sources)
        if unsplit:
            port = next(p for p in unsplit if "." in p)
            rationale = (
                f"{node} learns from rows that were never split ({port}), so it sees the "
                "test rows too. A model may only learn from a split's training rows."
            )
            cited = [node, port.split(".")[0]]
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)

    evaluators = sorted(
        n for n, op in op_of.items() if op.capability_class == CapabilityClass.evaluator
    )
    if not evaluators and holdouts and estimators:
        readers = sorted({str(n) for h in holdouts for n in graph.successors(h)})
        if readers:
            read = next(h for h in sorted(holdouts) if graph.has_edge(h, readers[0]))
            rationale = (
                f"{readers[0]} reads the test set ({read}) and "
                "is not an evaluator, so this check cannot tell whether it compares models on it."
            )
            return _result(pipeline, check_id, now, Verdict.not_assessed, rationale, readers)
        rationale = (
            f"No model learns from the test set ({', '.join(sorted(holdouts))}) or from rows "
            "that were never split, and no step reads the test set."
        )
        cited = sorted({*estimators, *(h.split(".")[0] for h in holdouts)})
        return _result(pipeline, check_id, now, Verdict.pass_, rationale, cited)
    if not evaluators:
        return _result(pipeline, check_id, now, Verdict.not_assessed, "No evaluator nodes.", [])

    candidates: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for evaluator in evaluators:
        table, model = _input_sources(evaluator, op_of[evaluator], graph)
        scored = holdouts & (nx.ancestors(graph, table) | {table})
        for model_node in _nearest_estimators(graph, model, op_of):
            if unversioned(op_of[model_node].id.root) in BASELINE_OPERATORS:
                continue
            for holdout in scored:
                candidates[holdout][model_node].add(evaluator)

    for holdout, models in sorted(candidates.items()):
        if len(models) > 1:
            cited = sorted({holdout.split(".")[0], *(e for evs in models.values() for e in evs)})
            rationale = (
                f"The test set ({holdout}) is used to compare {len(models)} models "
                f"({', '.join(sorted(models))}). Picking the winner on the test set makes its "
                "score look better than it is. Compare models with cross-validation on the "
                "training rows, then score only the chosen one on the test set."
            )
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)

    examined = sorted({*evaluators, *(h.split(".")[0] for h in holdouts)})
    rationale = (
        f"The test set ({', '.join(sorted(holdouts)) or 'none'}) scores at most one model "
        "besides the baseline, and no model learns from it."
    )
    return _result(pipeline, check_id, now, Verdict.pass_, rationale, examined)


def unversioned(ref: str) -> str:
    """An operator ref without its version: `sprisk.ml.evaluate@1.0.0` -> `sprisk.ml.evaluate`."""
    return ref.split("@")[0]


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
    # A fitting transform's train output carries only its train input; its test output
    # depends on both. Without this, every model after a transform looks fit on test rows.
    for node, op in op_of.items():
        if unversioned(op.id.root) in FITTING_TRANSFORMS:
            source = _source_of(graph, node, TRAIN_PORT)
            graph.remove_edge(node, f"{node}.{TRAIN_PORT}")
            graph.add_edge(source, f"{node}.{TRAIN_PORT}")
    return graph


def _fit_problem(
    graph: PortGraph,
    cut: PortGraph,
    node: str,
    splits: list[str],
    sources: set[str],
    holdouts: set[str],
) -> tuple[str, list[str]] | None:
    """Why a fitting transform's inputs are wrong, or None.

    `train` must reach data sources only through one split's train port, and `test`
    must come from that same split's holdout. `cut` is `graph` without the splits' train ports.
    """
    train_src = _source_of(graph, node, TRAIN_PORT)
    test_src = _source_of(graph, node, "test")
    train_lineage = nx.ancestors(graph, train_src) | {train_src}
    fed_by = [s for s in splits if f"{s}.{TRAIN_PORT}" in train_lineage]
    reach = (
        (nx.ancestors(cut, train_src) | {train_src.split(".")[0]}) if train_src in cut else set()
    )
    if holdouts & train_lineage:
        where = f"the test set ({sorted(holdouts & train_lineage)[0]})"
    elif not fed_by or sources & reach:
        where = f"rows that were never split ({train_src})"
    else:
        test_lineage = nx.ancestors(graph, test_src) | {test_src}
        own = {h for h in holdouts if h.split(".")[0] in fed_by}
        if own & test_lineage:
            return None
        return (
            f"{node} gets its test rows from a different split than its training rows; "
            f"it comes from {test_src}.",
            sorted({node, test_src.split(".")[0]}),
        )
    return (
        f"{node} learns its settings from {where}. Fit it on the training rows only.",
        sorted({node, train_src.split(".")[0]}),
    )


def _source_of(graph: PortGraph, node: str, port: str) -> str:
    """The upstream output port feeding `node.port`."""
    for src in graph.predecessors(node):
        if _feeds(graph, src, node, port):
            return str(src)
    raise CheckInputError(f"input {node}.{port} is not connected")


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
