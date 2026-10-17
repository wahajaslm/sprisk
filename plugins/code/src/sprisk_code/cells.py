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

from sprisk_code.discovery import literal_parameters, scalar_literal
from sprisk_contracts import CodeSplit, CodeSplitRequest

# import, literal: copied into the reader. function, container: keep definer and reader
# together. value: a link, passed on as a table.
Kind = Literal["import", "literal", "function", "container", "value"]

PORT_NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
# Ports every code step already has, and names the step runner provides.
RESERVED = {"display", "interface", "console"}
PROVIDED = {"display"}
BUILTINS = set(dir(builtins))
MAGIC = re.compile(r"^\s*[%!]")
CELL_JOIN = "\n\n# %%\n"
NAME_RULE = "only lowercase names, not display, interface or console"
IMPORTS_COPIED = "its imports are copied into the steps that use them"
_Note = tuple[int, str]


@dataclass
class _Code:
    """What one cell, or several cells kept together, reads and sets."""

    source: str
    reads: list[str] = field(default_factory=list)
    sets: dict[str, tuple[Kind, ast.stmt]] = field(default_factory=dict)
    deleted: set[str] = field(default_factory=set)
    only_imports: bool = False
    error: str | None = None


def split_cells(cells: list[str], together: tuple[int, int] | None = None) -> CodeSplit:
    """`together`: cells first..last start as one step, the cells a person picked to make a
    node from (ADR-0036). Other cells may still join it, by the same rules as any step."""
    kept = [(i, _without_magics(c)) for i, c in enumerate(cells) if c.strip()]
    sources = dict(kept)
    groups = _start_groups([i for i, _ in kept], together)
    notes: list[_Note] = []
    codes = [_read(CELL_JOIN.join(sources[i] for i in g)) for g in groups]
    while (merge := _first_merge(groups, codes)) is not None:
        start, end, message, cell = merge
        merged = [i for g in groups[start : end + 1] for i in g]
        groups[start : end + 1] = [merged]
        # Only the merged group changed; the rest keep what was read. The cell marker keeps
        # each cell visible in the notebook view (ADR-0033).
        codes[start : end + 1] = [_read(CELL_JOIN.join(sources[i] for i in merged))]
        notes.append((cell, message))
    return _steps(groups, codes, notes)


def _start_groups(kept: list[int], together: tuple[int, int] | None) -> list[list[int]]:
    if together is None:
        return [[i] for i in kept]
    first, last = together
    picked = [i for i in kept if first <= i <= last]
    before = [[i] for i in kept if i < first]
    after = [[i] for i in kept if i > last]
    return before + ([picked] if picked else []) + after


def _without_magics(cell: str) -> str:
    return "\n".join(
        f"# {line.strip()}" if MAGIC.match(line) else line for line in cell.splitlines()
    )


def _read(source: str) -> _Code:
    code = _Code(source)
    try:
        module = ast.parse(source)
        for stmt in module.body:
            _add(code, stmt)
    # Valid Python that symtable or the parser still rejects (`nonlocal` at top level, very
    # deep nesting) is noted for the person, never a failed request.
    except (SyntaxError, RecursionError, MemoryError) as e:
        line = getattr(e, "lineno", None)
        where = f"line {line}: " if line else ""
        return _Code(source, error=f"{where}{getattr(e, 'msg', None) or type(e).__name__}")
    code.only_imports = bool(module.body) and all(
        isinstance(s, ast.Import | ast.ImportFrom) for s in module.body
    )
    return code


def _add(code: _Code, stmt: ast.stmt) -> None:
    reads, sets = _statement(stmt)
    code.reads += [
        n for n in reads if n not in code.sets and n not in code.deleted and n not in code.reads
    ]
    if isinstance(stmt, ast.Delete):
        for name in (t.id for t in stmt.targets if isinstance(t, ast.Name)):
            code.sets.pop(name, None)
            code.deleted.add(name)
        sets = [n for n in sets if n not in code.deleted]
    kind = _kind(stmt)
    for name in sets:
        code.sets[name] = (kind, stmt)
        code.deleted.discard(name)
    # A table changed in place (`df["a"] = 1`, `inplace=True`) is passed on changed.
    for name in _changed_in_place(stmt) - set(sets):
        code.sets[name] = ("value", stmt)


def _changed_in_place(stmt: ast.stmt) -> set[str]:
    changed = set()
    for node in ast.walk(stmt):
        if isinstance(node, ast.Subscript | ast.Attribute) and isinstance(
            node.ctx, ast.Store | ast.Del
        ):
            base = _base_name(node)
        elif isinstance(node, ast.Call) and any(
            k.arg == "inplace" and isinstance(k.value, ast.Constant) and k.value.value is True
            for k in node.keywords
        ):
            base = _base_name(node.func)
        else:
            continue
        if base is not None:
            changed.add(base)
    return changed


def _base_name(node: ast.expr) -> str | None:
    while isinstance(node, ast.Subscript | ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _statement(stmt: ast.stmt) -> tuple[list[str], list[str]]:
    """Names a top-level statement reads before it sets them, in order, and the names it sets.
    symtable decides scope; source position decides order. Unparsed, so decorators count."""
    table = symtable.symtable(ast.unparse(stmt), "<cell>", "exec")
    module = {s.get_name(): s for s in table.get_symbols()}
    sets = [n for n, s in module.items() if s.is_assigned() or s.is_imported()]
    globals_read = {n for n, s in module.items() if s.is_referenced()} | _globals_in(table)
    if isinstance(stmt, ast.AugAssign) and isinstance(stmt.target, ast.Name):
        globals_read.add(stmt.target.id)  # `total += 1` reads total first
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
    if not isinstance(stmt, ast.Assign):
        return "value"
    one_name = len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name)
    if one_name and scalar_literal(stmt.value) is not None:
        return "literal"
    if isinstance(stmt.value, ast.List | ast.Dict | ast.Set | ast.Tuple):
        # Not a table, and a later line may change it, so a copy could be stale.
        return "container"
    return "value"


def _definer(codes: list[_Code], reader: int, name: str) -> int | None:
    """The latest earlier step that sets `name`, unless one deleted it since."""
    for i in range(reader - 1, -1, -1):
        if name in codes[i].sets:
            return i
        if name in codes[i].deleted:
            return None
    return None


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
            elif kind == "container":
                why = f"{name} is a list, dict, set or tuple from cell {groups[i][0] + 1}"
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
    parameters: list[dict[str, object]] = field(default_factory=list)


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
        if not code.error:
            step.parameters = [
                {"name": p.name, "value": ast.literal_eval(p.default_text)}
                for p in literal_parameters(step.source)
            ]
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
    together = (request.together.first, request.together.last) if request.together else None
    cells = [c.root for c in request.cells]
    sys.stdout.write(split_cells(cells, together).model_dump_json())


if __name__ == "__main__":
    main()
