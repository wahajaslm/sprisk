"""Static discovery for code steps (ADR-0021). Reads the source without running it and
suggests an interface. Suggestions only: dynamic Python can always do more than this sees."""

import ast
import builtins
from collections import Counter
from dataclasses import dataclass
from typing import Any, Literal

from sprisk_workers.errors import OperatorError

ValueType = Literal["integer", "number", "string", "boolean"]


@dataclass(frozen=True)
class Parameter:
    name: str
    line: int
    value_type: ValueType
    default_text: str


def _literal(node: ast.expr) -> object | None:
    """The constant a node spells, including a negative number; None when it is not one."""
    if isinstance(node, ast.Constant) and isinstance(node.value, bool | int | float | str):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        inner = _literal(node.operand)
        if isinstance(inner, int | float) and not isinstance(inner, bool):
            return -inner
    return None


def _type_of(value: object) -> ValueType:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "string"


def _candidates(module: ast.Module) -> dict[str, ast.Assign]:
    """Top-level `name = literal` assignments to names assigned exactly once at top level.
    A name assigned twice has no single place to bind, so it is left out."""
    counts = Counter(
        name.id
        for stmt in module.body
        if isinstance(stmt, ast.Assign | ast.AugAssign | ast.AnnAssign)
        for target in (stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target])
        for name in ast.walk(target)
        if isinstance(name, ast.Name)
    )
    found: dict[str, ast.Assign] = {}
    for stmt in module.body:
        if (
            isinstance(stmt, ast.Assign)
            and len(stmt.targets) == 1
            and isinstance(stmt.targets[0], ast.Name)
            and counts[stmt.targets[0].id] == 1
            and _literal(stmt.value) is not None
        ):
            found[stmt.targets[0].id] = stmt
    return found


def literal_parameters(source: str) -> list[Parameter]:
    module = ast.parse(source)
    return [
        Parameter(name, stmt.lineno, _type_of(_literal(stmt.value)), ast.unparse(stmt.value))
        for name, stmt in _candidates(module).items()
    ]


def free_names(source: str) -> list[str]:
    """Names the code reads but never defines, in order of first use, without builtins."""
    module = ast.parse(source)
    defined: set[str] = set(dir(builtins))
    for node in ast.walk(module):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store | ast.Del):
            defined.add(node.id)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            defined.add(node.name)
        elif isinstance(node, ast.arg):
            defined.add(node.arg)
        elif isinstance(node, ast.alias):
            defined.add((node.asname or node.name).split(".")[0])
        elif isinstance(node, ast.ExceptHandler) and node.name:
            defined.add(node.name)
    seen: list[str] = []
    for node in ast.walk(module):
        if not (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)):
            continue
        if node.id not in defined and node.id not in seen:
            seen.append(node.id)
    return sorted(seen, key=lambda n: _first_use(module, n))


def _first_use(module: ast.Module, name: str) -> tuple[int, int]:
    uses = [
        (n.lineno, n.col_offset)
        for n in ast.walk(module)
        if isinstance(n, ast.Name) and n.id == name
    ]
    return min(uses)


def bind(source: str, values: dict[str, Any]) -> ast.Module:
    """A rewritten copy of the source with each exposed parameter set to its value. The
    caller's source text is never changed; the run records the effective values."""
    module = ast.parse(source)
    candidates = _candidates(module)
    for name, value in values.items():
        stmt = candidates.get(name)
        if stmt is None:
            raise OperatorError(
                "unknown_parameter",
                f"{name} is not a top-level literal assignment in this code, so it cannot be set",
            )
        expected = _type_of(_literal(stmt.value))
        if not isinstance(value, bool | int | float | str):
            raise OperatorError("invalid_parameter", f"{name} expects a {expected}, got {value!r}")
        if _type_of(value) != expected and not (
            expected == "number" and _type_of(value) == "integer"
        ):
            raise OperatorError("invalid_parameter", f"{name} expects a {expected}, got {value!r}")
        stmt.value = ast.Constant(value)
    return ast.fix_missing_locations(module)
