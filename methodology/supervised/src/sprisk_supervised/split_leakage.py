from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import networkx as nx

from sprisk_contracts import ExecutionPlan, MethodologyCheck, Operator, PipelineVersion
from sprisk_contracts.generated.models import (
    CapabilityClass,
    OperatorRole,
    PortKind,
    Side,
    Verdict,
)

CHECK = "supervised.split_leakage@1.0.0"

# Vertices: node ids and their output ports ("node.port").
type PortGraph = nx.DiGraph[Any]

# Splits, the baseline and fitting transforms are found by their manifests, never by name
# (ADR-0064): a split by its role, the baseline as a model with no family, a fitting
# transform by fits_on_train. Every split seals its test output; other split outputs may be
# used for selection.
HOLDOUT_PORT = "test"
TRAIN_PORT = "train"
# A code step may split rows in a way this check cannot see.
CODE_OPERATOR = "sprisk.code.python"
WORDS_PORT = "words"


def is_split(op: Operator) -> bool:
    return op.role == OperatorRole.split


def is_baseline(op: Operator) -> bool:
    """Baseline models are reference points, not candidates: a supervised model with no
    family, as the comparison treats it."""
    return op.model is not None and bool(op.model.tasks) and op.model.family is None


def measures_split(op: Operator) -> bool:
    """An evidence producer the engine adds on a split's output: it reads train and test to
    measure the split, and writes only a report, so nothing downstream can score on them."""
    attach = op.attach
    return (
        attach is not None
        and attach.role == OperatorRole.split
        and attach.side == Side.output
        and op.capability_class == CapabilityClass.analyzer
        and all(port.kind != PortKind.model for port in op.inputs)
        and all(port.kind == PortKind.report for port in op.outputs)
    )


def fits_on_train(op: Operator) -> bool:
    return op.fits_on_train is True


def fits_on_all_it_reads(op: Operator) -> bool:
    """A step that fits a model on its rows but is not a model and does not keep train rows
    apart, such as a clustering step: whatever rows it reads shape its output."""
    return (
        op.model is not None
        and op.capability_class != CapabilityClass.estimator
        and not fits_on_train(op)
    )


LIMITATIONS = (
    "Looks at this version of the flow only. If earlier versions compared models on the "
    "same test set, this check cannot see it."
)


class CheckInputError(ValueError):
    """The pipeline is not one Gate A would accept, so the rule cannot run."""


def split_leakage(
    pipeline: PipelineVersion,
    plan: ExecutionPlan,
    operators: Mapping[str, Operator],
    check_id: str,
    now: str,
) -> MethodologyCheck:
    """FAIL when a holdout is used to fit or to choose between models (ADR-0015, §15.11).

    - A fitting transform must learn from a split's train rows, never unsplit data or a holdout.
    - Any estimator downstream of a holdout port was fit on it.
    - When the flow has a split, an estimator that reaches a data source other than through a
      split's train port was fit on rows that include the holdout.
    - A step that fits on all it reads (clustering) and feeds a model must read only a split's
      train rows.
    - Per holdout, evaluators may score at most one non-baseline model, where a
      model is the nearest estimator upstream of the evaluator's model input.
    - With no split step, a model scored on rows from the source it learns from FAILS; with a
      code step that may split them, NOT_ASSESSED. Never PASS.
    """
    if plan.pipeline_version_id != pipeline.id:
        raise CheckInputError(
            f"the plan is of {plan.pipeline_version_id.root}, not {pipeline.id.root}"
        )
    op_of = operators_by_node(pipeline, operators)
    # The graph is the one Rust compiled, ports and row lineage included (ADR-0070).
    graph = _port_graph(plan)
    splits = [n for n, op in op_of.items() if is_split(op)]
    holdouts = {f"{node}.{HOLDOUT_PORT}" for node in splits}
    sources = {n for n, op in op_of.items() if op.capability_class == CapabilityClass.source}
    # Cut every split's train port; any data source still reachable bypassed the split.
    cut = graph.copy()
    cut.remove_nodes_from(f"{s}.{TRAIN_PORT}" for s in splits)
    for node in sorted(n for n, op in op_of.items() if fits_on_train(op)):
        problem = _fit_problem(graph, cut, node, splits, sources, holdouts)
        if problem:
            rationale, cited = problem
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)

    estimators = sorted(
        n for n, op in op_of.items() if op.capability_class == CapabilityClass.estimator
    )
    for node in sorted(n for n, op in op_of.items() if fits_on_all_it_reads(op)):
        problem = _fit_on_test_rows(graph, cut, node, estimators, holdouts, sources)
        if problem:
            rationale, cited = problem
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)
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
        all_readers = {str(n) for h in holdouts for n in graph.successors(h)}
        measuring = sorted(n for n in all_readers if measures_split(op_of[n]))
        readers = sorted(all_readers - set(measuring))
        if readers:
            read = next(h for h in sorted(holdouts) if graph.has_edge(h, readers[0]))
            rationale = (
                f"{readers[0]} reads the test set ({read}) and "
                "is not an evaluator, so this check cannot tell whether it compares models on it."
            )
            return _result(pipeline, check_id, now, Verdict.not_assessed, rationale, readers)
        read = (
            f"only steps that measure the split read it ({', '.join(measuring)})"
            if measuring
            else "no step reads the test set"
        )
        rationale = (
            f"No model learns from the test set ({', '.join(sorted(holdouts))}) or from rows "
            f"that were never split, and {read}."
        )
        cited = sorted({*estimators, *measuring, *(h.split(".")[0] for h in holdouts)})
        return _result(pipeline, check_id, now, Verdict.pass_, rationale, cited)
    if not evaluators:
        return _result(pipeline, check_id, now, Verdict.not_assessed, "No evaluator nodes.", [])
    if not splits and estimators:
        if not any(unversioned(op.id.root) == CODE_OPERATOR for op in op_of.values()):
            problem = _scored_on_own_rows(graph, op_of, evaluators, sources)
            if problem:
                rationale, cited = problem
                return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)
        rationale = (
            "No split step, so this check cannot find the test rows the models are scored on. "
            "A split written as code is not checked."
        )
        return _result(pipeline, check_id, now, Verdict.not_assessed, rationale, evaluators)

    for evaluator in evaluators:
        problem = _words_problem(evaluator, graph)
        if problem:
            rationale, cited = problem
            return _result(pipeline, check_id, now, Verdict.fail, rationale, cited)

    candidates: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for evaluator in evaluators:
        table, model = _input_sources(evaluator, op_of[evaluator], graph)
        scored = holdouts & (nx.ancestors(graph, table) | {table})
        for model_node in _nearest_estimators(graph, model, op_of):
            if is_baseline(op_of[model_node]):
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
    """An operator ref without its version: `sprisk.ml.evaluate@2.1.0` -> `sprisk.ml.evaluate`."""
    return ref.split("@")[0]


def operators_by_node(
    pipeline: PipelineVersion, operators: Mapping[str, Operator]
) -> dict[str, Operator]:
    op_of = {}
    for node in pipeline.nodes:
        op = operators.get(node.operator.root)
        if op is None:
            raise CheckInputError(f"node {node.id.root}: unknown operator {node.operator.root}")
        op_of[node.id.root] = op
    return op_of


def _port_graph(plan: ExecutionPlan) -> PortGraph:
    """Vertices are steps and their output ports: step → step.port → consumer step. An output
    that holds the rows of only some inputs, as a fitting transform's train output holds only
    its train input, hangs from those inputs' sources instead of its step."""
    graph: PortGraph = nx.DiGraph()
    for step in plan.steps:
        node = step.node_id.root
        graph.add_node(node)
        fed = {i.port.root: i.from_.root for i in step.inputs}
        for i in step.inputs:
            graph.add_edge(i.from_.root, node)
            graph.edges[i.from_.root, node].setdefault("ports", set()).add(i.port.root)
        for out in step.outputs:
            port = f"{node}.{out.name.root}"
            rows_from = {p.root for p in out.rows_from}
            if rows_from == set(fed):
                graph.add_edge(node, port)
            else:
                unfed = sorted(rows_from - set(fed))
                if unfed:
                    raise CheckInputError(f"input {node}.{unfed[0]} is not connected")
                graph.add_edges_from((fed[p], port) for p in rows_from)
    return graph


def _scored_on_own_rows(
    graph: PortGraph, op_of: Mapping[str, Operator], evaluators: list[str], sources: set[str]
) -> tuple[str, list[str]] | None:
    """A model an evaluator scores on rows from the source it learns from, with no step that
    could split them: its score is on its own training rows."""
    for evaluator in evaluators:
        table, model = _input_sources(evaluator, op_of[evaluator], graph)
        scored = sources & (nx.ancestors(graph, table) | {table.split(".")[0]})
        for node in sorted(_nearest_estimators(graph, model, op_of)):
            if is_baseline(op_of[node]):
                continue
            shared = sorted(scored & nx.ancestors(graph, node))
            if shared:
                rationale = (
                    f"{node} is scored on the rows it learns from ({shared[0]}): no step splits "
                    "them. Add a split and score the model on its test rows."
                )
                return rationale, sorted({node, evaluator, shared[0]})
    return None


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


def _fit_on_test_rows(
    graph: PortGraph,
    cut: PortGraph,
    node: str,
    estimators: list[str],
    holdouts: set[str],
    sources: set[str],
) -> tuple[str, list[str]] | None:
    """Why a step that fits on all it reads leaks test rows into a model, or None. Only a
    model after it makes its fit matter; looking at clusters of every row is not a leak."""
    fed = sorted(e for e in estimators if nx.has_path(graph, node, e))
    if not fed:
        return None
    if holdouts & nx.ancestors(graph, node):
        where = "the test set"
    elif sources & (nx.ancestors(cut, node) | {node}):
        where = "rows that were never split"
    else:
        return None
    return (
        f"{node} fits on {where}, and {fed[0]} learns from its output, so the model sees the "
        f"test rows through it. Fit {node} on a split's training rows only.",
        sorted({node, fed[0]}),
    )


def _words_problem(evaluator: str, graph: PortGraph) -> tuple[str, list[str]] | None:
    """An evaluator's words must be the test words of the step the model's train words came
    from (ADR-0058). Train words share the test words' columns, so nothing else catches it."""
    scored_with = _source_or_none(graph, evaluator, WORDS_PORT)
    if scored_with is None:
        return None
    model = _source_of(graph, evaluator, "model").split(".")[0]
    fit_on = _source_or_none(graph, model, WORDS_PORT) or ""
    maker = fit_on.removesuffix(".train_words")
    if fit_on != maker and scored_with == f"{maker}.test_words":
        return None
    rationale = (
        f"{evaluator} scores {model} with {scored_with}, but only the test words of the step "
        f"its train words came from ({fit_on or 'none'}) may score it."
    )
    return rationale, sorted({evaluator, model, scored_with.split(".")[0]})


def _source_or_none(graph: PortGraph, node: str, port: str) -> str | None:
    return next((str(s) for s in graph.predecessors(node) if _feeds(graph, s, node, port)), None)


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
        if not upstream and not port.optional:
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
