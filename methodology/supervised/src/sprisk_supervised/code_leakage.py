"""The code layer of split leakage (ADR-0040): fits written in code steps.

Reads each code step's source by its syntax only; never runs it. Each name carries tags for
the rows its value comes from: `train` or `holdout` rows of a split, and `fitted` when a
fitting transform has already learned from them. Tags follow assignments in source order and
cross steps along the flow's edges.
"""

import ast
from collections.abc import Iterator, Mapping
from typing import Literal

import networkx as nx

from sprisk_contracts import MethodologyCheck, Operator, PipelineVersion
from sprisk_contracts.generated.models import Node, Verdict
from sprisk_supervised.split_leakage import (
    CODE_OPERATOR,
    HOLDOUT_PORT,
    TRAIN_PORT,
    CheckInputError,
    fits_on_train,
    is_split,
    operators_by_node,
    unversioned,
)

CHECK = "supervised.code_leakage@1.0.0"

# scikit-learn classes that learn statistics from the rows they are fit on.
FITTING_TRANSFORMERS = frozenset(
    {
        "StandardScaler", "MinMaxScaler", "MaxAbsScaler", "RobustScaler",
        "QuantileTransformer", "PowerTransformer", "KBinsDiscretizer",
        "SimpleImputer", "KNNImputer", "IterativeImputer",
        "OneHotEncoder", "OrdinalEncoder", "TargetEncoder",
        "PCA", "TruncatedSVD", "SelectKBest", "SelectPercentile",
        "VarianceThreshold", "RFE", "RFECV", "SelectFromModel",
    }
)  # fmt: skip
CV_FUNCTIONS = frozenset({"cross_val_score", "cross_validate", "cross_val_predict"})
SEARCH_CV = frozenset(
    {"GridSearchCV", "RandomizedSearchCV", "HalvingGridSearchCV", "HalvingRandomSearchCV"}
)
CV_SPLITTERS = frozenset(
    {
        "KFold", "StratifiedKFold", "GroupKFold", "StratifiedGroupKFold", "TimeSeriesSplit",
        "ShuffleSplit", "StratifiedShuffleSplit", "GroupShuffleSplit",
    }
)  # fmt: skip
FIT_METHODS = frozenset({"fit", "fit_transform", "partial_fit"})

LIMITATIONS = (
    "Reads the code without running it. It cannot see fits inside functions, loops over "
    "cross-validation folds, or libraries other than scikit-learn."
)

type Tag = Literal["train", "holdout", "fitted"]
type Tags = frozenset[Tag]
NONE: Tags = frozenset()
FITTED: Tags = frozenset({"fitted"})


class _Step:
    """What one code step's source shows, read in source order."""

    def __init__(self, tags: dict[str, Tags]) -> None:
        self.tags = tags
        self.classes: dict[str, str] = {}
        self.splits = False
        self.leak: tuple[int, str] | None = None
        self.unsplit_fits: list[tuple[int, str, str]] = []

    def read(self, module: ast.Module) -> None:
        events: list[tuple[tuple[int, int, int], ast.AST]] = []
        for n in _outside_definitions(module):
            if isinstance(n, ast.Call):
                events.append(((n.end_lineno or 0, n.end_col_offset or 0, 0), n))
            elif isinstance(n, ast.For | ast.AsyncFor):
                events.append(((n.iter.end_lineno or 0, n.iter.end_col_offset or 0, 1), n))
            elif isinstance(n, ast.Assign | ast.AnnAssign | ast.AugAssign | ast.NamedExpr):
                events.append(((n.end_lineno or 0, n.end_col_offset or 0, 1), n))
        for _, n in sorted(events, key=lambda e: e[0]):
            if isinstance(n, ast.Call):
                self._call(n)
            else:
                self._assign(n)

    def _call(self, call: ast.Call) -> None:
        func = call.func
        cls = self._class_of(func.value) if isinstance(func, ast.Attribute) else None
        method = func.attr if isinstance(func, ast.Attribute) else None
        if _last_name(func) == "train_test_split":
            self.splits = True
        elif (
            _last_name(func) in CV_FUNCTIONS
            or (method == "split" and cls in CV_SPLITTERS)
            or (method == "fit" and cls in SEARCH_CV)
        ):
            self.splits = True
            self._note_leak(
                call,
                "fitted",
                "passes already-scaled or already-selected rows to cross-validation",
            )
        if method not in FIT_METHODS or not call.args:
            return
        self._note_leak(call, "holdout", "learns from test-set rows")
        first = self._tags_of(call.args[0])
        if cls in FITTING_TRANSFORMERS and not first & {"train", "holdout"}:
            self.unsplit_fits.append((call.lineno, cls, ast.unparse(call.args[0])))

    def _note_leak(self, call: ast.Call, tag: Tag, what: str) -> None:
        if self.leak:
            return
        for arg in [*call.args, *(k.value for k in call.keywords)]:
            for n in ast.walk(arg):
                if isinstance(n, ast.Name) and tag in self.tags.get(n.id, NONE):
                    self.leak = (call.lineno, f"{what} ({n.id})")
                    return

    def _assign(self, n: ast.AST) -> None:
        if isinstance(n, ast.For | ast.AsyncFor):
            self._bind(n.target, self._tags_of(n.iter), None)
        elif isinstance(n, ast.AugAssign):
            self._bind(n.target, self._tags_of(n.target) | self._tags_of(n.value), None)
        elif isinstance(n, ast.AnnAssign | ast.NamedExpr):
            if n.value is not None:
                self._bind(n.target, self._tags_of(n.value), self._class_of(n.value))
        elif isinstance(n, ast.Assign):
            if _last_name_of_call(n.value) == "train_test_split":
                for target in n.targets:
                    self._bind_split(target)
                return
            for target in n.targets:
                self._bind_value(target, n.value)

    def _bind_value(self, target: ast.expr, value: ast.expr) -> None:
        sequences = (ast.Tuple, ast.List)
        if (
            isinstance(target, sequences)
            and isinstance(value, sequences)
            and len(target.elts) == len(value.elts)
        ):
            for t, v in zip(target.elts, value.elts, strict=True):
                self._bind_value(t, v)
            return
        self._bind(target, self._tags_of(value), self._class_of(value))

    def _bind(self, target: ast.expr, tags: Tags, cls: str | None) -> None:
        for name in (x.id for x in ast.walk(target) if isinstance(x, ast.Name)):
            self.tags[name] = tags
            self.classes.pop(name, None)
            if cls:
                self.classes[name] = cls

    def _bind_split(self, target: ast.expr) -> None:
        if not isinstance(target, ast.Tuple):
            return
        for i, element in enumerate(target.elts):
            if isinstance(element, ast.Name):
                self.tags[element.id] = frozenset({"train" if i % 2 == 0 else "holdout"})

    def _tags_of(self, expr: ast.expr) -> Tags:
        tags: set[Tag] = set()
        for n in ast.walk(expr):
            if isinstance(n, ast.Name):
                tags |= self.tags.get(n.id, NONE)
            elif isinstance(n, ast.Call) and self._is_transform(n):
                tags.add("fitted")
        return frozenset(tags)

    def _is_transform(self, call: ast.Call) -> bool:
        func = call.func
        return (
            isinstance(func, ast.Attribute)
            and func.attr in {"transform", "fit_transform"}
            and self._class_of(func.value) in FITTING_TRANSFORMERS
        )

    def _class_of(self, expr: ast.expr) -> str | None:
        """The class an expression is an instance of, when it is built here."""
        if isinstance(expr, ast.Name):
            return self.classes.get(expr.id)
        if not isinstance(expr, ast.Call):
            return None
        if isinstance(expr.func, ast.Attribute) and expr.func.attr == "fit":
            return self._class_of(expr.func.value)
        name = _last_name(expr.func)
        return name if name and name[0].isupper() else None


def code_leakage(
    pipeline: PipelineVersion, operators: Mapping[str, Operator], check_id: str, now: str
) -> MethodologyCheck:
    """FAIL when code fits on holdout rows, cross-validates rows a fitting transform already
    learned from, or fits a transform on unsplit rows that are split in a connected step."""
    graph: nx.DiGraph[str] = nx.DiGraph()
    graph.add_nodes_from(n.id.root for n in pipeline.nodes)
    for edge in pipeline.edges:
        graph.add_edge(edge.from_.root.split(".")[0], edge.to.root.split(".")[0])
    nodes = {n.id.root: n for n in pipeline.nodes}
    code_nodes = [n for n in nx.topological_sort(graph) if _is_code(nodes[n])]
    if not code_nodes:
        return _result(pipeline, check_id, now, Verdict.not_assessed, "No code steps.", [])

    op_of = operators_by_node(pipeline, operators)
    built_splits = frozenset(n for n, op in op_of.items() if is_split(op))
    split_nodes = set(built_splits)
    fitting = frozenset(n for n, op in op_of.items() if fits_on_train(op))
    steps: dict[str, _Step] = {}
    unread = []
    for node in code_nodes:
        source = (nodes[node].params.model_extra or {}).get("source")
        if not isinstance(source, str):
            raise CheckInputError(f"code step {node}: params.source is missing")
        inputs = {
            e.to.root.split(".")[1]: _port_tags(
                pipeline, steps, e.from_.root, built_splits, fitting
            )
            for e in pipeline.edges
            if e.to.root.split(".")[0] == node
        }
        steps[node] = step = _Step(inputs)
        try:
            step.read(ast.parse(source))
        except SyntaxError:
            unread.append(node)
            continue
        if step.splits:
            split_nodes.add(node)

    finding = _first_finding(graph, steps, split_nodes)
    if finding:
        return _result(pipeline, check_id, now, Verdict.fail, *finding)
    if unread:
        rationale = f"Could not read the code of {', '.join(unread)}; it has a syntax error."
        return _result(pipeline, check_id, now, Verdict.not_assessed, rationale, unread)
    if not split_nodes:
        rationale = "There is no split in the flow, so there is no test set to protect."
        return _result(pipeline, check_id, now, Verdict.not_assessed, rationale, code_nodes)
    rationale = (
        f"Read the code of {', '.join(code_nodes)}. No model learns from the test set, and "
        "no scaling or feature selection happens before the split."
    )
    return _result(pipeline, check_id, now, Verdict.pass_, rationale, code_nodes)


def _first_finding(
    graph: "nx.DiGraph[str]", steps: Mapping[str, _Step], split_nodes: set[str]
) -> tuple[str, list[str]] | None:
    for node, step in steps.items():
        if step.leak:
            line, what = step.leak
            return (f"{node} line {line}: {what}.", [node])
        related = sorted(
            s for s in split_nodes
            if s == node or nx.has_path(graph, node, s) or nx.has_path(graph, s, node)
        )  # fmt: skip
        for line, cls, data in step.unsplit_fits:
            if related:
                where = "this step" if related == [node] else ", ".join(related)
                return (
                    f"{node} line {line}: {cls} learns from {data} before the data is split "
                    f"({where}), so it sees the test rows. Fit it on the training rows, or put "
                    "it in a Pipeline inside cross-validation.",
                    sorted({node, *related}),
                )
    return None


def _port_tags(
    pipeline: PipelineVersion,
    steps: Mapping[str, _Step],
    port: str,
    splits: frozenset[str],
    fitting: frozenset[str],
) -> Tags:
    """Tags of the rows an output port carries. A built-in step passes on its inputs' tags:
    the input of the same name when it has one, else all of them."""
    node, name = port.split(".")
    if node in splits:
        if name == HOLDOUT_PORT:
            return frozenset({"holdout"})
        return frozenset({"train"}) if name == TRAIN_PORT else NONE
    if node in steps:
        return steps[node].tags.get(name, NONE)
    feeding = [e for e in pipeline.edges if e.to.root.split(".")[0] == node]
    same = [e for e in feeding if e.to.root.split(".")[1] == name]
    tags: Tags = NONE.union(
        *(_port_tags(pipeline, steps, e.from_.root, splits, fitting) for e in same or feeding)
    )
    return tags | FITTED if node in fitting else tags


def _outside_definitions(tree: ast.AST) -> Iterator[ast.AST]:
    """Every node except the bodies of functions, lambdas and classes, which may never run."""
    for child in ast.iter_child_nodes(tree):
        if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda | ast.ClassDef):
            continue
        yield child
        yield from _outside_definitions(child)


def _last_name(expr: ast.expr) -> str | None:
    if isinstance(expr, ast.Name):
        return expr.id
    if isinstance(expr, ast.Attribute):
        return expr.attr
    return None


def _last_name_of_call(expr: ast.expr) -> str | None:
    return _last_name(expr.func) if isinstance(expr, ast.Call) else None


def _is_code(node: Node) -> bool:
    return unversioned(node.operator.root) == CODE_OPERATOR


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
