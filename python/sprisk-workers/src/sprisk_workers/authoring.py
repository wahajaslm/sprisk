"""What a pack author writes with (ADR-0071). A decorator only records what a function
declares; `build_packs` compiles the record into the Method IR."""

import ast
import inspect
import typing
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any, TypeVar

import polars as pl

from sprisk_workers.errors import ManifestError

F = TypeVar("F", bound=Callable[..., Any])

ATTRIBUTE = "__sprisk__"
RESOURCES = {"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600}
VERDICTS = ("pass", "fail", "inconclusive")
# A setting naming columns: at least one, each once. Extra schema rides on `Annotated`.
Columns = Annotated[
    list[str], {"items": {"type": "string", "minLength": 1}, "minItems": 1, "uniqueItems": True}
]
# Return types the app draws: Plotly and Vega-Lite (Altair).
VIEW_TYPES = {"go.Figure", "alt.Chart"}


@dataclass(frozen=True)
class Verdict:
    """What a promise finds: its result, a sentence a person reads, and the named evidence
    that makes the result auditable."""

    status: str
    detail: str
    evidence: dict[str, Any]

    def __post_init__(self) -> None:
        if self.status not in VERDICTS:
            raise ValueError(f"{self.status} is not a verdict; use one of {VERDICTS}")

    def record(self) -> dict[str, Any]:
        return {**self.evidence, "status": self.status, "detail": self.detail}


@dataclass(frozen=True)
class PromiseDeclaration:
    id: str
    text: str
    evidence: str
    fields: dict[str, Any]
    concepts: dict[str, str]
    version: str
    title: str


@dataclass(frozen=True)
class OperatorDeclaration:
    id: str
    # Port name to kind, in port order; an output may carry a description.
    inputs: dict[str, str]
    outputs: dict[str, str]
    described: dict[str, str]
    role: str | None
    folds: str | None
    role_default: bool
    concepts: dict[str, str]
    tunables: dict[str, dict[str, float]]
    promises: tuple[Callable[..., Any], ...]
    version: str
    capability_class: str
    resources: dict[str, Any]
    stage: str | None
    # Manifest fields written as given (title, scope, attach, produces, fits_on_train, effects).
    fields: dict[str, Any]


@dataclass(frozen=True)
class VisualizationDeclaration:
    title: str | None


@dataclass(frozen=True)
class Option:
    """A methodological choice, and the operator that carries it out. `when` says in plain
    words when the method takes it; `condition` says the same as a formula. `fallbacks` are
    the options that may stand in when its promise breaks; none means no fair option is left."""

    label: str
    operator: Callable[..., Any]
    when: str
    condition: str
    fallbacks: tuple[str, ...]


@dataclass(frozen=True)
class Choice:
    option: str
    reason: str


@dataclass(frozen=True)
class MethodDeclaration:
    id: str
    decides: str
    activity: str
    applies_when: dict[str, list[str]]
    decisions: tuple[str, ...]
    concepts: dict[str, str]
    options: dict[str, Option]
    source: str
    version: str


class Binding:
    """A concept the project has bound. It is truthy and never holds the column name: a
    method decides on meanings, not on one dataset's names (ADR-0063)."""

    def __bool__(self) -> bool:
        return True

    def __repr__(self) -> str:
        return "Binding()"


def _record(declaration: object) -> Callable[[F], F]:
    def attach(fn: F) -> F:
        setattr(fn, ATTRIBUTE, declaration)
        return fn

    return attach


def promise(
    *,
    id: str,
    text: str,
    evidence: str,
    fields: dict[str, Any],
    columns: dict[str, str] | None = None,
    concepts: dict[str, str] | None = None,
    version: str = "1.0.0",
    title: str | None = None,
) -> Callable[[F], F]:
    """`evidence` names what the check measures, e.g. `evaluation.group_overlap`; `fields`
    its typed values. A promise returns a `Verdict`. `title` names its evidence step."""
    return _record(
        PromiseDeclaration(
            id,
            text,
            evidence,
            fields,
            {**(concepts or {}), **(columns or {})},
            version,
            title or text,
        )
    )


def operator(
    *,
    id: str,
    inputs: list[str] | dict[str, str],
    outputs: list[str] | dict[str, Any],
    role: str | None = None,
    folds: str | None = None,
    role_default: bool = False,
    columns: dict[str, str] | None = None,
    concepts: dict[str, str] | None = None,
    tunables: dict[str, dict[str, float]] | None = None,
    promises: list[Callable[..., Any]] | None = None,
    version: str = "1.0.0",
    capability_class: str = "transform",
    resources: dict[str, Any] | None = None,
    stage: str | None = None,
    title: str | None = None,
    scope: str | None = None,
    attach: dict[str, str] | None = None,
    produces: dict[str, Any] | None = None,
    fits_on_train: bool | None = None,
    effects: str | None = None,
) -> Callable[[F], F]:
    """`columns=` is the short form of `concepts=` for a concept bound to a table column.
    `stage` is where its steps show; its promises' check steps show there too. Ports listed by
    name are tables; a dict names each port's kind."""
    for check in promises or []:
        if not isinstance(getattr(check, ATTRIBUTE, None), PromiseDeclaration):
            raise ManifestError(f"{id} lists {check.__name__}, which is not a promise")
    return _record(
        OperatorDeclaration(
            id=id,
            inputs=_ports(inputs),
            outputs=_ports(outputs),
            described={
                name: spec["description"]
                for name, spec in (outputs.items() if isinstance(outputs, dict) else [])
                if isinstance(spec, dict)
            },
            role=role,
            folds=folds,
            role_default=role_default,
            concepts={**(concepts or {}), **(columns or {})},
            tunables=tunables or {},
            promises=tuple(promises or []),
            version=version,
            capability_class=capability_class,
            resources=resources or dict(RESOURCES),
            stage=stage,
            fields={
                k: v
                for k, v in {
                    "title": title,
                    "scope": scope,
                    "attach": attach,
                    "produces": produces,
                    "fits_on_train": fits_on_train,
                    "effects": effects,
                }.items()
                if v is not None
            },
        )
    )


def visualization(*, title: str | None = None) -> Callable[[F], F]:
    """Marks a view of the operator in the same file. A function annotated `-> go.Figure` or
    `-> alt.Chart`, spelled so, is one without the mark."""
    return _record(VisualizationDeclaration(title))


def _ports(ports: list[str] | dict[str, Any]) -> dict[str, str]:
    if not isinstance(ports, dict):
        return {name: "table" for name in ports}
    return {name: spec["kind"] if isinstance(spec, dict) else spec for name, spec in ports.items()}


def option(
    label: str,
    operator: Callable[..., Any],
    *,
    when: str,
    condition: str,
    fallbacks: list[str] | None = None,
) -> Option:
    return Option(label, operator, when, condition, tuple(fallbacks or []))


class _Method:
    """`@method(...)` declares a method; `method.choose(option, reason=...)` is its answer."""

    choose = staticmethod(Choice)

    def __call__(
        self,
        *,
        id: str,
        decides: str,
        activity: str,
        applies_when: dict[str, list[str]],
        options: dict[str, Option],
        source: str,
        decisions: list[str] | None = None,
        columns: dict[str, str] | None = None,
        concepts: dict[str, str] | None = None,
        version: str = "1.0.0",
    ) -> Callable[[F], F]:
        """The function's docstring is the method's name, its question, then its pitfall. Each
        concept parameter gets a `Binding` when the project binds it, else None. Each option's
        rationale is the reason its `method.choose` gives."""
        for option_id, choice in options.items():
            unknown = set(choice.fallbacks) - set(options)
            if unknown:
                raise ManifestError(f"option {option_id} falls back to {sorted(unknown)}")
            if declared(choice.operator) is None:
                raise ManifestError(
                    f"option {option_id} names {choice.operator.__name__}, which is not an operator"
                )
        return _record(
            MethodDeclaration(
                id=id,
                decides=decides,
                activity=activity,
                applies_when=applies_when,
                decisions=tuple(decisions or []),
                concepts={**(concepts or {}), **(columns or {})},
                options=options,
                source=source,
                version=version,
            )
        )


method = _Method()


def declared(fn: Callable[..., Any]) -> OperatorDeclaration | None:
    found = getattr(fn, ATTRIBUTE, None)
    return found if isinstance(found, OperatorDeclaration) else None


def declared_promise(fn: Callable[..., Any]) -> PromiseDeclaration | None:
    found = getattr(fn, ATTRIBUTE, None)
    return found if isinstance(found, PromiseDeclaration) else None


def declared_method(fn: Callable[..., Any]) -> MethodDeclaration | None:
    found = getattr(fn, ATTRIBUTE, None)
    return found if isinstance(found, MethodDeclaration) else None


def tables(fn: Callable[..., Any]) -> list[str]:
    """The parameters that receive a table: the operator's inputs."""
    hints = typing.get_type_hints(fn)
    return [name for name in inspect.signature(fn).parameters if hints.get(name) is pl.DataFrame]


def visualizations(op: Callable[..., Any]) -> list[Callable[..., Any]]:
    """The views in the operator's file, in file order: marked `@visualization`, or returning
    a view type. A file with views holds one operator, so each view has one owner."""
    module = inspect.getmodule(op)
    if module is None:
        raise ManifestError(f"{op.__name__} has no module to read its views from")
    tree = ast.parse(inspect.getsource(module))
    found = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        fn = getattr(module, node.name)
        returns = node.returns is not None and ast.unparse(node.returns) in VIEW_TYPES
        if returns or isinstance(getattr(fn, ATTRIBUTE, None), VisualizationDeclaration):
            found.append(fn)
    operators = [
        v
        for v in vars(module).values()
        if declared(v) is not None and v.__module__ == module.__name__
    ]
    if found and len(operators) > 1:
        raise ManifestError(
            f"{module.__name__} has views and {len(operators)} operators; "
            "an operator file holds one"
        )
    return found


def view_title(view: Callable[..., Any]) -> str:
    """The marked title, else the docstring's first line, else the function's name."""
    found = getattr(view, ATTRIBUTE, None)
    if isinstance(found, VisualizationDeclaration) and found.title:
        return found.title
    return (inspect.getdoc(view) or view.__name__).splitlines()[0]
