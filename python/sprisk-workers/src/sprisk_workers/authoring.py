"""What a pack author writes with (ADR-0071). A decorator only records what a function
declares; `build_packs` compiles the record into the Method IR."""

import inspect
import typing
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

import polars as pl

from sprisk_workers.errors import ManifestError

F = TypeVar("F", bound=Callable[..., Any])

ATTRIBUTE = "__sprisk__"
RESOURCES = {"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600}
VERDICTS = ("pass", "fail", "inconclusive")


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


@dataclass(frozen=True)
class OperatorDeclaration:
    id: str
    inputs: tuple[str, ...]
    outputs: tuple[str, ...]
    role: str | None
    folds: str | None
    role_default: bool
    concepts: dict[str, str]
    tunables: dict[str, dict[str, float]]
    promises: tuple[Callable[..., Any], ...]
    version: str
    capability_class: str
    resources: dict[str, Any]


@dataclass(frozen=True)
class Option:
    """A methodological choice, and the operator that carries it out. `when` says in plain
    words when the method takes it; `condition` says the same as a formula."""

    label: str
    operator: Callable[..., Any]
    when: str
    condition: str


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
) -> Callable[[F], F]:
    """`evidence` names what the check measures, e.g. `evaluation.group_overlap`; `fields`
    its typed values. A promise returns a `Verdict`."""
    return _record(
        PromiseDeclaration(
            id, text, evidence, fields, {**(concepts or {}), **(columns or {})}, version
        )
    )


def operator(
    *,
    id: str,
    inputs: list[str],
    outputs: list[str],
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
) -> Callable[[F], F]:
    """`columns=` is the short form of `concepts=` for a concept bound to a table column."""
    for check in promises or []:
        if not isinstance(getattr(check, ATTRIBUTE, None), PromiseDeclaration):
            raise ManifestError(f"{id} lists {check.__name__}, which is not a promise")
    return _record(
        OperatorDeclaration(
            id=id,
            inputs=tuple(inputs),
            outputs=tuple(outputs),
            role=role,
            folds=folds,
            role_default=role_default,
            concepts={**(concepts or {}), **(columns or {})},
            tunables=tunables or {},
            promises=tuple(promises or []),
            version=version,
            capability_class=capability_class,
            resources=resources or dict(RESOURCES),
        )
    )


def option(label: str, operator: Callable[..., Any], *, when: str, condition: str) -> Option:
    return Option(label, operator, when, condition)


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
