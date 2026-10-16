import ast
import base64
import contextlib
import io
import json
import traceback
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import matplotlib
import polars as pl

from sprisk_contracts import CodeDisplay
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import JSON, Output

matplotlib.use("Agg")  # no display in a worker
import matplotlib.pyplot as plt  # noqa: E402

FILENAME = "<code step>"
MAX_TABLE_ROWS = 50
MAX_TABLE_COLUMNS = 50
MAX_CELL_CHARS = 500
MAX_TEXT_CHARS = 20_000
MAX_FIGURES = 6


def python_step(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """Run the user's code on the input table and record what it shows (ADR-0020)."""
    source: str = params["source"]
    namespace: dict[str, Any] = {
        "__name__": "__sprisk_code__",
        "data": pl.read_parquet(inputs["data"]),
        "pl": pl,
    }
    stdout = io.StringIO()
    plt.close("all")
    try:
        body, last = _split_last_expression(source)
        with contextlib.redirect_stdout(stdout):
            exec(compile(body, FILENAME, "exec"), namespace)
            value = eval(compile(last, FILENAME, "eval"), namespace) if last else None
    except Exception as e:  # noqa: BLE001 - any error in user code fails the step with its line
        raise OperatorError("code_error", _describe(e)) from e

    items: list[dict[str, Any]] = []
    if stdout.getvalue():
        items.append({"kind": "text", "text": _cut(stdout.getvalue(), MAX_TEXT_CHARS)})
    if value is not None:
        items.append(_show(value))
    items += _figures()
    path = out_dir / "display.json"
    display = CodeDisplay.model_validate_json(json.dumps({"items": items}))
    path.write_text(display.model_dump_json(exclude_none=True))
    return [Output(port="display", path=path, media_type=JSON)]


def _split_last_expression(source: str) -> tuple[ast.Module, ast.Expression | None]:
    """Like a notebook: a trailing expression is evaluated and shown."""
    module = ast.parse(source, FILENAME)
    tail = module.body[-1] if module.body else None
    if isinstance(tail, ast.Expr):
        module.body.pop()
        return module, ast.Expression(tail.value)
    return module, None


def _describe(e: BaseException) -> str:
    if isinstance(e, SyntaxError):
        return f"line {e.lineno}: SyntaxError: {e.msg}"
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == FILENAME]
    where = f"line {frames[-1].lineno}: " if frames else ""
    return f"{where}{type(e).__name__}: {e}"


def _show(value: Any) -> dict[str, Any]:
    if isinstance(value, pl.Series):
        value = value.to_frame()
    if isinstance(value, pl.DataFrame):
        return {"kind": "table", "table": _table(value)}
    return {"kind": "text", "text": _cut(repr(value), MAX_TEXT_CHARS)}


def _table(df: pl.DataFrame) -> dict[str, Any]:
    shown = df.select(df.columns[:MAX_TABLE_COLUMNS]).head(MAX_TABLE_ROWS)
    rows = []
    for row in shown.iter_rows():
        missing = [i for i, v in enumerate(row) if v is None]
        values = ["" if v is None else _cut(str(v), MAX_CELL_CHARS) for v in row]
        rows.append({"values": values, "missing": missing})
    return {
        "offset": 0,
        "total_rows": df.height,
        "total_columns": df.width,
        "columns": [{"name": n, "data_type": str(t)} for n, t in shown.schema.items()],
        "rows": rows,
    }


def _figures() -> list[dict[str, Any]]:
    items = []
    for number in plt.get_fignums()[:MAX_FIGURES]:
        buffer = io.BytesIO()
        plt.figure(number).savefig(buffer, format="png", dpi=96, bbox_inches="tight")
        items.append({"kind": "image", "png_base64": base64.b64encode(buffer.getvalue()).decode()})
    plt.close("all")
    return items


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"
