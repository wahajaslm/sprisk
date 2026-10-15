import sys
from pathlib import Path
from typing import Annotated

import typer
from ulid import ULID

from sprisk_workers.manifests import load_operators
from sprisk_workers.serve import serve

app = typer.Typer(add_completion=False)


@app.command()
def main(
    plugins_root: Annotated[list[Path], typer.Option(exists=True, file_okay=False)],
    heartbeat_seconds: Annotated[float, typer.Option(min=0.01)] = 5.0,
) -> None:
    """Speak the worker protocol over stdio until stdin closes."""
    serve(sys.stdin, sys.stdout, f"wrk_{ULID()}", load_operators(*plugins_root), heartbeat_seconds)


if __name__ == "__main__":
    app()
