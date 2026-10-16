import ast
import base64
import contextlib
import io
import json
import shutil
import traceback
import warnings
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, TextIO

import matplotlib
import polars as pl

from sprisk_code.discovery import bind, free_names, literal_parameters
from sprisk_contracts import CodeDisplay, CodeInterface
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import JSON, PARQUET, Output

matplotlib.use("Agg")  # no display in a worker
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

FILENAME = "<code step>"
MAX_TABLE_ROWS = 50
MAX_TABLE_COLUMNS = 50
MAX_CELL_CHARS = 500
MAX_TEXT_CHARS = 20_000
MAX_FIGURES = 12
MAX_ITEMS = 100
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
TOOLS = ("pl", "sprisk", "display")
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

    shown = _Collector()
    namespace: dict[str, Any] = {
        "__name__": "__sprisk_code__",
        "data": pl.read_parquet(data),
        "pl": pl,
        "sprisk": SimpleNamespace(output=output),
        "display": shown.display,
    }
    plt.close("all")
    real_show = plt.show

    def show(*_: Any, **__: Any) -> None:
        shown.open_figures()

    plt.show = show  # notebook-style: show() puts open figures here, in order
    try:
        body, last = _split_last_expression(
            bind(source, values) if values else ast.parse(source, FILENAME)
        )
        with (
            contextlib.redirect_stdout(_Stream(shown, "stdout")),
            contextlib.redirect_stderr(_Stream(shown, "stderr")),
            warnings.catch_warnings(),
        ):
            # Warnings go to stderr in order, whatever hook the host process installed.
            warnings.simplefilter("default")
            warnings.showwarning = shown.warning
            exec(compile(body, FILENAME, "exec"), namespace)
            value = eval(compile(last, FILENAME, "eval"), namespace) if last else None
    except OperatorError:
        raise
    except Exception as e:  # noqa: BLE001 - any error in user code fails the step with its line
        raise OperatorError("code_error", _describe(e)) from e
    finally:
        plt.show = real_show

    if value is not None:
        shown.display(value)
    shown.open_figures()
    path = out_dir / "display.json"
    display = CodeDisplay.model_validate_json(json.dumps({"items": shown.items}))
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


class _Collector:
    """What a code step shows, in the order it happened: printed text, displayed values and
    figures. Everything is capped so one step cannot produce an unbounded display."""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self.figures = 0
        # The stream whose printed text the last item holds; further prints to it extend it.
        self.printing: str | None = None

    def _add(self, item: dict[str, Any]) -> None:
        self.printing = None
        if len(self.items) < MAX_ITEMS:
            self.items.append(item)

    def text(self, chunk: str, channel: str) -> None:
        if self.printing == channel and self.items:
            last = self.items[-1]
            last["text"] = _cut(last["text"] + chunk, MAX_TEXT_CHARS)
            return
        self._add({"kind": "text", "text": chunk, "channel": channel})
        self.printing = channel

    def display(self, *values: Any) -> None:
        for value in values:
            if isinstance(value, Figure):
                self.figure(value)
            elif isinstance(value, pl.Series | pl.DataFrame):
                frame = value.to_frame() if isinstance(value, pl.Series) else value
                self._add({"kind": "table", "table": _table(frame)})
            else:
                self._add({"kind": "text", "text": _cut(repr(value), MAX_TEXT_CHARS)})

    def figure(self, fig: Figure) -> None:
        self.figures += 1
        if self.figures > MAX_FIGURES:
            if self.figures == MAX_FIGURES + 1:
                self._add(
                    {
                        "kind": "text",
                        "text": f"More than {MAX_FIGURES} figures; the rest are not shown.",
                    }
                )
        else:
            buffer = io.BytesIO()
            fig.savefig(buffer, format="png", dpi=96, bbox_inches="tight")
            png = buffer.getvalue()
            if len(png) > MAX_FIGURE_BYTES:
                self._add(
                    {"kind": "text", "text": f"Figure {self.figures} not shown: {len(png)} bytes."}
                )
            else:
                self._add({"kind": "image", "png_base64": base64.b64encode(png).decode()})
        plt.close(fig)

    def warning(
        self,
        message: Warning | str,
        category: type[Warning],
        filename: str,
        lineno: int,
        file: TextIO | None = None,
        line: str | None = None,
    ) -> None:
        self.text(warnings.formatwarning(message, category, filename, lineno, line), "stderr")

    def open_figures(self) -> None:
        for number in plt.get_fignums():
            self.figure(plt.figure(number))


class _Stream(io.TextIOBase):
    """stdout or stderr that hands each write to the collector, so prints keep their place."""

    def __init__(self, collector: _Collector, channel: str) -> None:
        self.collector = collector
        self.channel = channel

    def write(self, chunk: str) -> int:
        if chunk:
            self.collector.text(chunk, self.channel)
        return len(chunk)


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


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"
