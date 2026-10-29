"""Write a ready-made step as plain Python for a notebook cell (ADR-0055).

Run as `python -m sprisk_workers.notebook_code <module:function>` with a NotebookCodeRequest on
stdin; prints a NotebookCode. With `--read` before the function, a NotebookSettingsRequest in
and NotebookSettings out: what an edited cell is. Rust picks the function from the step's
manifest.
"""

import ast
import builtins
import inspect
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sprisk_contracts import (
    NotebookCode,
    NotebookCodeRequest,
    NotebookSettings,
    NotebookSettingsRequest,
)
from sprisk_workers.authoring import declared, tables
from sprisk_workers.errors import ManifestError
from sprisk_workers.manifests import load_function


def _writer(entrypoint: str) -> "Write":
    found = load_function(Path(entrypoint), "notebook_code", entrypoint)
    # A decorated operator is its own notebook code (ADR-0071).
    return source_cell(found) if declared(found) else found


def write_code(entrypoint: str, request: NotebookCodeRequest) -> NotebookCode:
    write = _writer(entrypoint)
    inputs = {port: name.root for port, name in request.inputs.items()}
    outputs = {port: name.root for port, name in request.outputs.items()}
    return NotebookCode(code=write(request.settings, inputs, outputs))


def read_code(entrypoint: str, request: NotebookSettingsRequest) -> NotebookSettings:
    write = _writer(entrypoint)
    inputs = {port: name.root for port, name in request.inputs.items()}
    outputs = {port: name.root for port, name in request.outputs.items()}
    settings = read_settings(write, request.settings, inputs, outputs, request.code)
    if settings is None:
        return NotebookSettings.model_validate({"reads_as": "code"})
    return NotebookSettings.model_validate({"reads_as": "settings", "settings": settings})


Write = Callable[[dict[str, Any], dict[str, str], dict[str, str]], str]


def _cell_parts(fn: Callable[..., Any]) -> tuple[list[ast.Import | ast.ImportFrom], str, str]:
    """The module imports the function uses, the function's source without its decorator, and
    the module's source those imports come from."""
    module = inspect.getsource(inspect.getmodule(fn))  # type: ignore[arg-type]
    tree = ast.parse(module)
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == fn.__name__]
    if len(nodes) != 1:
        raise ManifestError(f"{fn.__module__}:{fn.__name__} is not a single top-level function")
    source = "\n".join(module.splitlines()[nodes[0].lineno - 1 : nodes[0].end_lineno])
    used = {n.id for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Name)}
    imports = [
        n
        for n in tree.body
        if isinstance(n, ast.Import | ast.ImportFrom) and any(_bound(a) in used for a in n.names)
    ]
    return imports, source, module


def _bound(alias: ast.alias) -> str:
    return (alias.asname or alias.name).split(".")[0]


def unresolved_names(fn: Callable[..., Any]) -> list[str]:
    """Names the function reads that its cell would not define: a module constant or helper
    the cell does not copy, which would fail with NameError in the notebook."""
    imports, source, _ = _cell_parts(fn)
    tree = ast.parse(source)
    read = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    defined = {
        n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and not isinstance(n.ctx, ast.Load)
    }
    defined |= {n.arg for n in ast.walk(tree) if isinstance(n, ast.arg)}
    defined |= {n.name for n in ast.walk(tree) if isinstance(n, ast.ExceptHandler) and n.name}
    defined |= {_bound(a) for n in imports for a in n.names} | {fn.__name__} | set(dir(builtins))
    return sorted(read - defined)


def source_cell(fn: Callable[..., Any]) -> Write:
    """Write a decorated operator as its own function, without its decorator, plus one call
    on the notebook's names. Only the imports the function uses come with it."""
    found = declared(fn)
    if found is None:
        raise ManifestError(f"{fn.__module__}:{fn.__name__} is not a decorated operator")
    nodes, source, module = _cell_parts(fn)
    imports = [ast.get_source_segment(module, n) or "" for n in nodes]
    inputs = tables(fn)
    # Other inputs, such as a matrix, go by name; one left unconnected is left out (ADR-0058).
    named = [i for i in found.inputs if i not in inputs]
    params = [p for p in inspect.signature(fn).parameters if p not in found.inputs]

    def write(settings: dict[str, Any], names_in: dict[str, str], names_out: dict[str, str]) -> str:
        args = (
            [names_in[i] for i in inputs]
            + [f"{i}={names_in[i]}" for i in named if i in names_in]
            + [f"{p}={settings[p]!r}" for p in params if p in settings]
        )
        results = ", ".join(names_out[o] for o in found.outputs)
        call = f"{results} = {fn.__name__}({', '.join(args)})"
        return "\n".join(imports) + f"\n\n\n{source}\n\n\n{call}\n"

    return write


# Stands in for one setting while the step's code is written, to find where its value goes.
MARK = "__sprisk_setting__"
# What the parser and literal_eval raise on edited code they cannot read: deep nesting, huge
# input, or a literal they refuse, like the set {[1]}. Edited code is untrusted text (rule 7).
UNREADABLE = (SyntaxError, ValueError, TypeError, MemoryError, RecursionError)


def read_settings(
    write: Write,
    settings: dict[str, Any],
    inputs: dict[str, str],
    outputs: dict[str, str],
    code: str,
) -> dict[str, Any] | None:
    """The settings `code` states, when it is the step's own code with only values changed:
    a person edited `n_estimators=200` to `500`, so the step keeps running, and keeps its
    checks, with n_estimators 500. None when the edit is more than that.

    Each setting is found by writing the code with MARK in its place; the edited code's value
    there is read with `ast.literal_eval`, so it is never run. The settings read are accepted
    only if they write the edited code again, comments and layout aside."""
    try:
        edited = ast.parse(code)
    except UNREADABLE:
        return None
    read = dict(settings)
    for key in settings:
        found = _values_of(write, settings, inputs, outputs, key, edited)
        if found is None:
            return None
        if found:
            if any(value != found[0] for value in found):
                return None
            read[key] = found[0]
    if ast.dump(ast.parse(write(read, inputs, outputs))) != ast.dump(edited):
        return None
    return read


def _values_of(
    write: Write,
    settings: dict[str, Any],
    inputs: dict[str, str],
    outputs: dict[str, str],
    key: str,
    edited: ast.Module,
) -> list[Any] | None:
    """The values the edited code has where `key`'s value goes; empty when it goes nowhere
    the code shows as written (the writer branches on it or computes with it). None when the
    edited code has something other than a value there."""
    try:
        marked = ast.parse(write({**settings, key: MARK}, inputs, outputs))
    # A writer that computes with the setting cannot take text in its place: not a value.
    except (TypeError, ValueError):
        return []
    places: list[ast.AST] = []
    if not _same_shape(marked, edited, places):
        return []
    try:
        return [ast.literal_eval(place) for place in places]
    except UNREADABLE:
        return None


def _same_shape(marked: ast.AST, edited: ast.AST, places: list[ast.AST]) -> bool:
    """Whether `edited` is `marked` with any values in its constants, collecting what it has
    where `marked` has MARK."""
    if isinstance(marked, ast.Constant) and marked.value == MARK:
        places.append(edited)
        return True
    if type(marked) is not type(edited):
        return False
    for field, value in ast.iter_fields(marked):
        other = getattr(edited, field, None)
        if isinstance(value, list):
            if not isinstance(other, list) or len(value) != len(other):
                return False
            pairs = zip(value, other, strict=True)
            if not all(_same_part(a, b, places) for a, b in pairs):
                return False
        elif isinstance(value, ast.AST):
            if not isinstance(other, ast.AST) or not _same_shape(value, other, places):
                return False
        # Other settings' values may have changed too; the final rewrite checks every value.
        elif not isinstance(marked, ast.Constant) and value != other:
            return False
    return True


def _same_part(a: Any, b: Any, places: list[ast.AST]) -> bool:
    if isinstance(a, ast.AST):
        return isinstance(b, ast.AST) and _same_shape(a, b, places)
    return bool(a == b)


def main() -> None:
    if sys.argv[1] == "--read":
        edited = NotebookSettingsRequest.model_validate_json(sys.stdin.read())
        sys.stdout.write(read_code(sys.argv[2], edited).model_dump_json())
        return
    request = NotebookCodeRequest.model_validate_json(sys.stdin.read())
    sys.stdout.write(write_code(sys.argv[1], request).model_dump_json())


if __name__ == "__main__":
    main()
