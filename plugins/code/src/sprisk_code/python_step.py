import ast
import base64
import contextlib
import io
import json
import shutil
import traceback
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import matplotlib
import polars as pl

from sprisk_code.discovery import bind, free_names, literal_parameters
from sprisk_contracts import CodeDisplay, CodeInterface
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import JSON, PARQUET, Output

matplotlib.use("Agg")  # no display in a worker
import matplotlib.pyplot as plt  # noqa: E402

FILENAME = "<code step>"
MAX_TABLE_ROWS = 50
MAX_TABLE_COLUMNS = 50
MAX_CELL_CHARS = 500
MAX_TEXT_CHARS = 20_000
MAX_FIGURES = 6
MAX_FIGURE_BYTES = 512 * 1024


def python_step(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """Run the user's code on the input table and record what it shows (ADR-0020)."""
    display, _, _ = _run(params["source"], {}, inputs["data"], out_dir)
    return [display]


def python_step_with_output(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """As `python_step`, plus a `data` output: the table passed to `sprisk.output`, or the
    input unchanged when the code passes nothing on."""
    display, result, _ = _run(params["source"], {}, inputs["data"], out_dir)
    return [_data_output(result, inputs["data"], out_dir), display]


def python_step_v12(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    """As `python_step_with_output`, plus exposed parameters bound into a copy of the code,
    a chosen output variable, and an `interface` report of what the run found (ADR-0021)."""
    source: str = params["source"]
    values: dict[str, Any] = dict(params.get("parameters", {}))
    chosen: str | None = params.get("output")
    display, passed, namespace = _run(source, values, inputs["data"], out_dir)
    result = passed
    if chosen is not None:
        value = namespace.get(chosen)
        if not isinstance(value, pl.DataFrame):
            raise OperatorError(
                "code_error",
                f"output {chosen} is not a polars DataFrame (it is {type(value).__name__})",
            )
        result = value
    path = out_dir / "interface.json"
    path.write_text(
        _interface(source, values, chosen, namespace).model_dump_json(exclude_none=True)
    )
    return [
        _data_output(result, inputs["data"], out_dir),
        display,
        Output(port="interface", path=path, media_type=JSON),
    ]


def _data_output(result: pl.DataFrame | None, data: Path, out_dir: Path) -> Output:
    path = out_dir / "data.parquet"
    if result is None:
        shutil.copyfile(data, path)  # same bytes, same hash: stored once
    else:
        result.write_parquet(path)
    return Output(port="data", path=path, media_type=PARQUET)


PROVIDED = ("data",)
# Tools the step itself puts in scope; reading them is not an input.
TOOLS = ("pl", "sprisk")
MAX_OUTPUT_CANDIDATES = 20


def _interface(
    source: str, values: dict[str, Any], chosen: str | None, namespace: dict[str, Any]
) -> CodeInterface:
    parameters = literal_parameters(source)
    names = {p.name for p in parameters}
    candidates = [
        n
        for n in _top_level_names(source)
        if n not in names
        and n in namespace
        and not isinstance(namespace[n], ModuleType | type)
        and not callable(namespace[n])
    ][:MAX_OUTPUT_CANDIDATES]
    doc = {
        "inputs": [
            {"name": n, "origin": "inferred", "bound": n in PROVIDED}
            for n in free_names(source)
            if n not in TOOLS
        ],
        "parameters": [
            {
                "name": p.name,
                "line": p.line,
                "value_type": p.value_type,
                "default_text": p.default_text,
                "effective_text": ast.unparse(ast.Constant(values[p.name]))
                if p.name in values
                else p.default_text,
                "origin": "confirmed" if p.name in values else "inferred",
            }
            for p in parameters
        ],
        "outputs": [_candidate(n, namespace[n], n == chosen) for n in candidates],
    }
    return CodeInterface.model_validate_json(json.dumps(doc))


def _top_level_names(source: str) -> list[str]:
    found: list[str] = []
    for stmt in ast.parse(source).body:
        if isinstance(stmt, ast.Assign | ast.AnnAssign | ast.AugAssign):
            targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
            for target in targets:
                for node in ast.walk(target):
                    if isinstance(node, ast.Name) and node.id not in found:
                        found.append(node.id)
    return found


def _candidate(name: str, value: object, chosen: bool) -> dict[str, Any]:
    kind = type(value)
    doc: dict[str, Any] = {
        "name": name,
        "type": f"{kind.__module__.split('.')[0]}.{kind.__name__}"
        if kind.__module__ != "builtins"
        else kind.__name__,
        "origin": "measured",
        "chosen": chosen,
    }
    if isinstance(value, pl.DataFrame):
        doc["rows"], doc["columns"] = value.height, value.width
    return doc


def _run(
    source: str, values: dict[str, Any], data: Path, out_dir: Path
) -> tuple[Output, pl.DataFrame | None, dict[str, Any]]:
    passed: list[pl.DataFrame] = []

    def output(df: object) -> None:
        if not isinstance(df, pl.DataFrame):
            raise TypeError(f"sprisk.output takes a polars DataFrame, got {type(df).__name__}")
        passed[:] = [df]

    namespace: dict[str, Any] = {
        "__name__": "__sprisk_code__",
        "data": pl.read_parquet(data),
        "pl": pl,
        "sprisk": SimpleNamespace(output=output),
    }
    stdout = io.StringIO()
    plt.close("all")
    try:
        body, last = _split_last_expression(
            bind(source, values) if values else ast.parse(source, FILENAME)
        )
        with contextlib.redirect_stdout(stdout):
            exec(compile(body, FILENAME, "exec"), namespace)
            value = eval(compile(last, FILENAME, "eval"), namespace) if last else None
    except OperatorError:
        raise
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
    result = passed[0] if passed else None
    return Output(port="display", path=path, media_type=JSON), result, namespace


def _split_last_expression(module: ast.Module) -> tuple[ast.Module, ast.Expression | None]:
    """Like a notebook: a trailing expression is evaluated and shown."""
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
        values = ["" if v is None else _cut(_text(v), MAX_CELL_CHARS) for v in row]
        rows.append({"values": values, "missing": missing})
    return {
        "offset": 0,
        "total_rows": df.height,
        "total_columns": df.width,
        "columns": [{"name": n, "data_type": str(t)} for n, t in shown.schema.items()],
        "rows": rows,
    }


def _text(value: Any) -> str:
    # Display only: six significant digits, like a notebook, not full float noise.
    return f"{value:.6g}" if isinstance(value, float) else str(value)


def _figures() -> list[dict[str, Any]]:
    items = []
    for number in plt.get_fignums()[:MAX_FIGURES]:
        buffer = io.BytesIO()
        plt.figure(number).savefig(buffer, format="png", dpi=96, bbox_inches="tight")
        png = buffer.getvalue()
        if len(png) > MAX_FIGURE_BYTES:
            items.append({"kind": "text", "text": f"Figure {number} not shown: {len(png)} bytes."})
            continue
        items.append({"kind": "image", "png_base64": base64.b64encode(png).decode()})
    plt.close("all")
    return items


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"
