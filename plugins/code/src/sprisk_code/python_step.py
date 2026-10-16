import ast
import base64
import contextlib
import io
import json
import reprlib
import traceback
import warnings
from collections.abc import Callable, Mapping
from types import ModuleType, SimpleNamespace
from typing import Any, TextIO

import matplotlib
import polars as pl

from sprisk_code.discovery import bind, file_reads, free_names, literal_parameters
from sprisk_contracts import CodeDisplay, CodeInterface
from sprisk_workers.errors import OperatorError

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


def python_step(data: pl.DataFrame, source: str) -> dict[str, Any]:
    """Run the user's code on the input table and record what it shows (ADR-0020)."""
    display, _, _ = _run(source, {}, data)
    return display


def python_step_with_output(data: pl.DataFrame, source: str) -> dict[str, Any]:
    """As `python_step`, plus a `data` output: the table passed to `sprisk.output`, or the
    input unchanged when the code passes nothing on."""
    display, result, _ = _run(source, {}, data)
    return {"data": data if result is None else result, "display": display}


def python_step_v12(
    data: pl.DataFrame,
    source: str,
    parameters: Mapping[str, Any] | None = None,
    output: str | None = None,
) -> dict[str, Any]:
    """As `python_step_with_output`, plus exposed parameters bound into a copy of the code,
    a chosen output variable, and an `interface` report of what the run found (ADR-0021)."""
    values = dict(parameters or {})
    display, passed, namespace = _run(source, values, data)
    result = data if passed is None else passed
    if output is not None:
        value = namespace.get(output)
        if not isinstance(value, pl.DataFrame):
            raise OperatorError(
                "code_error",
                f"output {output} is not a polars DataFrame (it is {type(value).__name__})",
            )
        result = value
    interface = _interface(source, values, output, namespace)
    return {
        "data": result,
        "display": display,
        "interface": interface.model_dump(mode="json", exclude_none=True),
    }


def load_function(source: str, function: str) -> Callable[..., Any]:
    """A step's own code (ADR-0028): define its module and return the step function. Run here
    because this is the one module allowed to execute user code (ADR-0020)."""
    namespace: dict[str, Any] = {"__name__": "__sprisk_step__"}
    try:
        exec(compile(source, FILENAME, "exec"), namespace)
    except Exception as e:  # noqa: BLE001 - user code: report it with its line, never hide it
        raise OperatorError("code_error", _describe(e)) from e
    found = namespace.get(function)
    if not callable(found):
        raise OperatorError("code_error", f"the code defines no function named {function}")
    step: Callable[..., Any] = found
    return step


PROVIDED = ("data",)
# Tools the step itself puts in scope; reading them is not an input.
TOOLS = ("pl", "sprisk", "display")
MAX_OUTPUT_CANDIDATES = 20
MAX_SAMPLE_ROWS = 10
MAX_FIELDS = 500
# Fields and samples of every variable share this; the browser reads the report whole.
EXPLORER_BUDGET_BYTES = 768 * 1024
# reprlib bounds the work as well as the text: a huge list is never fully formatted.
_VALUE_REPR = reprlib.Repr(maxlevel=3, maxlist=20, maxdict=20, maxstring=1000, maxother=1000)


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
        "outputs": _candidates_within_budget(candidates, namespace, chosen),
        "files": [{"path": f.path, "reader": f.reader, "line": f.line} for f in file_reads(source)],
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


def _candidates_within_budget(
    names: list[str], namespace: dict[str, Any], chosen: str | None
) -> list[dict[str, Any]]:
    """Each variable for the Data tab's explorer (ADR-0030). Fields and samples are added in
    order while they fit the budget, so many large tables cannot make the report unreadable."""
    left = EXPLORER_BUDGET_BYTES
    found = []
    for name in names:
        doc, extras = _candidate(name, namespace[name], name == chosen)
        for key, value in extras.items():
            size = len(json.dumps(value))
            if size <= left:
                doc[key] = value
                left -= size
        found.append(doc)
    return found


def _candidate(name: str, value: object, chosen: bool) -> tuple[dict[str, Any], dict[str, Any]]:
    kind = type(value)
    doc: dict[str, Any] = {
        "name": name,
        "type": f"{kind.__module__.split('.')[0]}.{kind.__name__}"
        if kind.__module__ != "builtins"
        else kind.__name__,
        "origin": "measured",
        "chosen": chosen,
    }
    if not isinstance(value, pl.DataFrame | pl.Series):
        doc["text"] = _VALUE_REPR.repr(value)
        return doc, {}
    frame = value.to_frame() if isinstance(value, pl.Series) else value
    doc["rows"], doc["columns"] = frame.height, frame.width
    nulls = frame.select(frame.columns[:MAX_FIELDS]).null_count().row(0)
    fields = [
        {"name": n, "data_type": str(t), "null_count": c}
        for (n, t), c in zip(list(frame.schema.items())[:MAX_FIELDS], nulls, strict=True)
    ]
    return doc, {"fields": fields, "sample": _table(frame, MAX_SAMPLE_ROWS)}


def _run(
    source: str, values: dict[str, Any], data: pl.DataFrame
) -> tuple[dict[str, Any], pl.DataFrame | None, dict[str, Any]]:
    passed: list[pl.DataFrame] = []

    def output(df: object) -> None:
        if not isinstance(df, pl.DataFrame):
            raise TypeError(f"sprisk.output takes a polars DataFrame, got {type(df).__name__}")
        passed[:] = [df]

    shown = _Collector()
    namespace: dict[str, Any] = {
        "__name__": "__sprisk_code__",
        "data": data,
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
    display = CodeDisplay.model_validate_json(json.dumps({"items": shown.items}))
    result = passed[0] if passed else None
    return display.model_dump(mode="json", exclude_none=True), result, namespace


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


def _table(df: pl.DataFrame, limit: int = MAX_TABLE_ROWS) -> dict[str, Any]:
    shown = df.select(df.columns[:MAX_TABLE_COLUMNS]).head(limit)
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
