"""What a pack author writes with (ADR-0071). A decorator only records what a function
declares; `build_packs` compiles the record into the Method IR."""

import inspect
import typing
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

import polars as pl

F = TypeVar("F", bound=Callable[..., Any])

ATTRIBUTE = "__sprisk_operator__"
RESOURCES = {"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600}


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
    version: str
    capability_class: str
    resources: dict[str, Any]


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
    version: str = "1.0.0",
    capability_class: str = "transform",
    resources: dict[str, Any] | None = None,
) -> Callable[[F], F]:
    """`columns=` is the short form of `concepts=` for a concept bound to a table column."""
    declaration = OperatorDeclaration(
        id=id,
        inputs=tuple(inputs),
        outputs=tuple(outputs),
        role=role,
        folds=folds,
        role_default=role_default,
        concepts={**(concepts or {}), **(columns or {})},
        tunables=tunables or {},
        version=version,
        capability_class=capability_class,
        resources=resources or dict(RESOURCES),
    )

    def record(fn: F) -> F:
        setattr(fn, ATTRIBUTE, declaration)
        return fn

    return record


def declared(fn: Callable[..., Any]) -> OperatorDeclaration | None:
    found = getattr(fn, ATTRIBUTE, None)
    return found if isinstance(found, OperatorDeclaration) else None


def tables(fn: Callable[..., Any]) -> list[str]:
    """The parameters that receive a table: the operator's inputs."""
    hints = typing.get_type_hints(fn)
    return [name for name in inspect.signature(fn).parameters if hints.get(name) is pl.DataFrame]
