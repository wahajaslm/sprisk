"""Split notebook cells into code steps (ADR-0031). Reads the code; never runs it.

In notebook order, a name a cell reads before setting it comes from the latest earlier cell
that sets it. Imports and literals are copied into the cell that uses them. A function, a
class, or a name that cannot be a port keeps the cells from its definer to its user together.
Everything else becomes a link: a table passed from one step to the next.

Run as `python -m sprisk_code.cells`: a CodeSplitRequest on stdin, a CodeSplit on stdout."""

import ast
import builtins
import json
import re
import symtable
import sys
from dataclasses import dataclass, field
from typing import Literal

from sprisk_contracts import CodeSplit, CodeSplitRequest

Kind = Literal["import", "literal", "function", "value"]

PORT_NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
# Ports every code step already has, and names the step runner provides.
RESERVED = {"display", "interface", "console"}
PROVIDED = {"display"}
BUILTINS = set(dir(builtins))
MAGIC = re.compile(r"^\s*[%!]")
NAME_RULE = "only lowercase names, not display, interface or console"
IMPORTS_COPIED = "its imports are copied into the steps that use them"
_Note = tuple[int, str]


@dataclass
class _Code:
    """What one cell, or several cells kept together, reads and sets."""

    source: str
    reads: list[str] = field(default_factory=list)
    sets: dict[str, tuple[Kind, ast.stmt]] = field(default_factory=dict)
    only_imports: bool = False
    error: str | None = None


def split_cells(cells: list[str]) -> CodeSplit:
    kept = [(i, _without_magics(c)) for i, c in enumerate(cells) if c.strip()]
    groups = [[i] for i, _ in kept]
    sources = dict(kept)
    notes: list[_Note] = []
    while True:
        codes = [_read("\n\n".join(sources[i] for i in g)) for g in groups]
        merge = _first_merge(groups, codes)
        if merge is None:
            break
        start, end, message, cell = merge
        groups[start : end + 1] = [[i for g in groups[start : end + 1] for i in g]]
        notes.append((cell, message))
    return _steps(groups, codes, notes)


def _without_magics(cell: str) -> str:
    return "\n".join(
        f"# {line.strip()}" if MAGIC.match(line) else line for line in cell.splitlines()
    )


def _read(source: str) -> _Code:
    code = _Code(source)
    try:
        module = ast.parse(source)
    except SyntaxError as e:
        code.error = f"line {e.lineno}: {e.msg}"
        return code
    code.only_imports = bool(module.body) and all(
        isinstance(s, ast.Import | ast.ImportFrom) for s in module.body
    )
    for stmt in module.body:
        reads, sets = _statement(source, stmt)
        code.reads += [n for n in reads if n not in code.sets and n not in code.reads]
        for name in sets:
            code.sets[name] = (_kind(stmt), stmt)
    return code


def _statement(source: str, stmt: ast.stmt) -> tuple[list[str], list[str]]:
    """Names a top-level statement reads before it sets them, in order, and the names it sets.
    symtable decides scope; source position decides order."""
    text = ast.get_source_segment(source, stmt) or ast.unparse(stmt)
    table = symtable.symtable(text, "<cell>", "exec")
    module = {s.get_name(): s for s in table.get_symbols()}
    sets = [n for n, s in module.items() if s.is_assigned() or s.is_imported()]
    globals_read = {n for n, s in module.items() if s.is_referenced()} | _globals_in(table)
    if isinstance(stmt, ast.Assign | ast.AugAssign | ast.AnnAssign) and stmt.value is not None:
        # The value is evaluated before the target is set: `df = df.dropna()` reads df.
        first = ast.Module(body=[ast.Expr(stmt.value)], type_ignores=[])
        before = {n.id for n in ast.walk(first) if isinstance(n, ast.Name)}
        if isinstance(stmt, ast.AugAssign) and isinstance(stmt.target, ast.Name):
            before.add(stmt.target.id)
        local = set(sets) - before
    else:
        local = _set_before_read(stmt, set(sets))
    reads = [
        n for n in _in_order(stmt) if n in globals_read and n not in local and n not in BUILTINS
    ]
    return list(dict.fromkeys(reads)), sets


def _globals_in(table: symtable.SymbolTable) -> set[str]:
    found = set()
    for child in table.get_children():
        found |= {s.get_name() for s in child.get_symbols() if s.is_global() and s.is_referenced()}
        found |= _globals_in(child)
    return found


def _set_before_read(stmt: ast.stmt, sets: set[str]) -> set[str]:
    """In a compound statement, a name first seen being set is local; first seen read is not."""
    first: dict[str, bool] = {}
    for node in sorted(
        (n for n in ast.walk(stmt) if isinstance(n, ast.Name)),
        key=lambda n: (n.lineno, n.col_offset),
    ):
        first.setdefault(node.id, isinstance(node.ctx, ast.Store))
    return {n for n in sets if first.get(n, True)}


def _in_order(stmt: ast.stmt) -> list[str]:
    nodes = sorted(
        (n for n in ast.walk(stmt) if isinstance(n, ast.Name)),
        key=lambda n: (n.lineno, n.col_offset),
    )
    return [n.id for n in nodes]


def _kind(stmt: ast.stmt) -> Kind:
    if isinstance(stmt, ast.Import | ast.ImportFrom):
        return "import"
    if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
        return "function"
    if (
        isinstance(stmt, ast.Assign)
        and len(stmt.targets) == 1
        and isinstance(stmt.targets[0], ast.Name)
    ):
        try:
            ast.literal_eval(stmt.value)
        except ValueError:
            return "value"
        return "literal"
    return "value"


def _definer(codes: list[_Code], reader: int, name: str) -> int | None:
    return next((i for i in range(reader - 1, -1, -1) if name in codes[i].sets), None)


def _first_merge(groups: list[list[int]], codes: list[_Code]) -> tuple[int, int, str, int] | None:
    """The first read that cannot cross a step: keep definer to reader together."""
    for j, code in enumerate(codes):
        for name in code.reads:
            i = _definer(codes, j, name)
            if i is None:
                continue
            kind = codes[i].sets[name][0]
            if kind == "function":
                why = f"{name} is a function or class from cell {groups[i][0] + 1}"
            elif kind == "value" and (not PORT_NAME.match(name) or name in RESERVED):
                why = f"{name} cannot be passed between steps ({NAME_RULE})"
            else:
                continue
            cells = f"cells {groups[i][0] + 1}–{groups[j][-1] + 1}"
            return i, j, f"{why}; {cells} stay in one step", groups[j][0]
    return None


@dataclass
class _Step:
    cells: list[int]
    source: str = ""
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)


def _steps(groups: list[list[int]], codes: list[_Code], notes: list[_Note]) -> CodeSplit:
    by_group: dict[int, _Step] = {}
    links: list[tuple[int, int, str]] = []
    for j, (group, code) in enumerate(zip(groups, codes, strict=True)):
        first = group[0] + 1
        if code.only_imports:
            notes.append((group[0], f"cell {first} only imports; {IMPORTS_COPIED}"))
            continue
        if code.error:
            notes.append((group[0], f"cell {first} does not parse: {code.error}"))
        step = by_group[j] = _Step(group)
        copied: list[str] = []
        for name in code.reads:
            i = _definer(codes, j, name)
            if i is None:
                if name not in PROVIDED:
                    notes.append(
                        (group[0], f"cell {first} reads {name}, which no earlier cell sets")
                    )
                continue
            kind, stmt = codes[i].sets[name]
            if kind in ("import", "literal"):
                copied.append(ast.get_source_segment(codes[i].source, stmt) or ast.unparse(stmt))
                continue
            if name not in by_group[i].outputs:
                by_group[i].outputs.append(name)
            step.inputs.append(name)
            links.append((i, j, name))
        header = "\n".join(dict.fromkeys(copied))
        step.source = f"{header}\n{code.source}" if header else code.source
    position = {j: k for k, j in enumerate(by_group)}
    doc = {
        "steps": [vars(step) for step in by_group.values()],
        "links": [
            {"from_step": position[i], "to_step": position[j], "name": n} for i, j, n in links
        ],
        "notes": [{"cell": c, "message": m} for c, m in sorted(notes, key=lambda n: n[0])],
    }
    return CodeSplit.model_validate_json(json.dumps(doc))


def main() -> None:
    request = CodeSplitRequest.model_validate_json(sys.stdin.read())
    sys.stdout.write(split_cells([c.root for c in request.cells]).model_dump_json())


if __name__ == "__main__":
    main()
