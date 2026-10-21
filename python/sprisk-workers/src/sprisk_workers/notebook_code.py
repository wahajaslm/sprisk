"""Write a ready-made step as plain Python for a notebook cell (ADR-0055).

Run as `python -m sprisk_workers.notebook_code <module:function>` with a NotebookCodeRequest on
stdin; prints a NotebookCode. Rust picks the function from the step's manifest.
"""

import sys
from pathlib import Path

from sprisk_contracts import NotebookCode, NotebookCodeRequest
from sprisk_workers.manifests import _function


def write_code(entrypoint: str, request: NotebookCodeRequest) -> NotebookCode:
    write = _function(Path(entrypoint), "notebook_code", entrypoint)
    inputs = {port: name.root for port, name in request.inputs.items()}
    outputs = {port: name.root for port, name in request.outputs.items()}
    return NotebookCode(code=write(request.settings, inputs, outputs))


def main() -> None:
    request = NotebookCodeRequest.model_validate_json(sys.stdin.read())
    sys.stdout.write(write_code(sys.argv[1], request).model_dump_json())


if __name__ == "__main__":
    main()
