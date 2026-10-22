"""Write a ready-made step as plain Python for a notebook cell (ADR-0055).

Run as `python -m sprisk_workers.notebook_code <module:function>` with a NotebookCodeRequest on
stdin; prints a NotebookCode. With `--read` before the function, a NotebookSettingsRequest in
and NotebookSettings out: what an edited cell is. Rust picks the function from the step's
manifest.
"""

import ast
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
from sprisk_workers.manifests import load_function


def write_code(entrypoint: str, request: NotebookCodeRequest) -> NotebookCode:
    write = load_function(Path(entrypoint), "notebook_code", entrypoint)
    inputs = {port: name.root for port, name in request.inputs.items()}
    outputs = {port: name.root for port, name in request.outputs.items()}
    return NotebookCode(code=write(request.settings, inputs, outputs))


def read_code(entrypoint: str, request: NotebookSettingsRequest) -> NotebookSettings:
    write = load_function(Path(entrypoint), "notebook_code", entrypoint)
    inputs = {port: name.root for port, name in request.inputs.items()}
    outputs = {port: name.root for port, name in request.outputs.items()}
    settings = read_settings(write, request.settings, inputs, outputs, request.code)
    if settings is None:
        return NotebookSettings.model_validate({"reads_as": "code"})
    return NotebookSettings.model_validate({"reads_as": "settings", "settings": settings})


Write = Callable[[dict[str, Any], dict[str, str], dict[str, str]], str]
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
