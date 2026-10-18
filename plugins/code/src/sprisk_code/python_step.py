import ast
import contextlib
import io
import json
import reprlib
import sys
import traceback
import warnings
from collections.abc import Callable, Mapping
from types import FrameType, ModuleType, SimpleNamespace
from typing import Any, TextIO

import matplotlib
import polars as pl

from sprisk_code.discovery import bind, file_reads, free_names, literal_parameters
from sprisk_code.shown import (
    MAX_FIGURE_BYTES,
    MAX_FIGURES,
    MAX_ITEMS,
    MAX_TEXT_CHARS,
    as_polars,
    cut,
    is_table,
    table_page,
)
from sprisk_contracts import CodeDisplay, CodeInterface
from sprisk_workers.errors import OperatorError
from sprisk_workers.plain import figure_item

matplotlib.use("Agg")  # no display in a worker
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

FILENAME = "<code step>"


def python_step(data: pl.DataFrame, source: str) -> dict[str, Any]:
    """Run the user's code on the input table and record what it shows (ADR-0020)."""
    provided, _ = _with_data(data)
    display, _ = _run(source, {}, provided)
    return display


def python_step_with_output(data: pl.DataFrame, source: str) -> dict[str, Any]:
    """As `python_step`, plus a `data` output: the table passed to `sprisk.output`, or the
    input unchanged when the code passes nothing on."""
    provided, passed = _with_data(data)
    display, _ = _run(source, {}, provided)
    return {"data": passed[0] if passed else data, "display": display}


def python_step_v12(
    data: pl.DataFrame,
    source: str,
    parameters: Mapping[str, Any] | None = None,
    output: str | None = None,
) -> dict[str, Any]:
    """As `python_step_with_output`, plus exposed parameters bound into a copy of the code,
    a chosen output variable, and an `interface` report of what the run found (ADR-0021)."""
    values = dict(parameters or {})
    provided, passed = _with_data(data)
    display, namespace = _run(source, values, provided)
    result = passed[0] if passed else data
    if output is not None:
        value = namespace.get(output)
        if not isinstance(value, pl.DataFrame):
            raise OperatorError(
                "code_error",
                f"output {output} is not a polars DataFrame (it is {type(value).__name__})",
            )
        result = value
    chosen = {output} if output else set()
    interface = _interface(source, values, namespace, set(PROVIDED), chosen)
    return {
        "data": result,
        "display": display,
        "interface": interface.model_dump(mode="json", exclude_none=True),
    }


def python_step_v2(
    inputs: Mapping[str, Any],
    source: str,
    parameters: Mapping[str, Any] | None = None,
    outputs: list[str] | None = None,
) -> dict[str, Any]:
    """Notebook cells as a step (ADR-0031): each input table under its own name, and each
    variable a later step reads passed on under its name. Nothing sprisk-specific is in scope
    but `display`, as in a notebook."""
    values = dict(parameters or {})
    display, namespace = _run(source, values, dict(inputs))
    passed = {}
    for name in outputs or []:
        if name not in namespace:
            raise OperatorError(
                "code_error", f"the code does not set {name}, which a later step reads"
            )
        value = namespace[name]
        if not is_table(value):
            raise OperatorError(
                "code_error",
                f"{name} is a {type(value).__name__}, not a table. Only tables pass between "
                "steps: keep the cells that use it in one step.",
            )
        passed[name] = value
    interface = _interface(source, values, namespace, set(inputs), set(passed))
    return {
        "display": display,
        "interface": interface.model_dump(mode="json", exclude_none=True),
        **passed,
    }


def _with_data(data: pl.DataFrame) -> tuple[dict[str, Any], list[pl.DataFrame]]:
    """What a v1 code step sees: its input as `data`, polars as `pl`, and `sprisk.output`."""
    passed: list[pl.DataFrame] = []

    def output(df: object) -> None:
        if not isinstance(df, pl.DataFrame):
            raise TypeError(f"sprisk.output takes a polars DataFrame, got {type(df).__name__}")
        passed[:] = [df]

    return {"data": data, "pl": pl, "sprisk": SimpleNamespace(output=output)}, passed


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


MAX_LABEL_CHARS = 80
PROVIDED = ("data",)
# Tools the step itself puts in scope; reading them is not an input.
TOOLS = ("pl", "sprisk", "display")
MAX_OUTPUT_CANDIDATES = 20
MAX_SAMPLE_ROWS = 10
MAX_FIELDS = 500
MAX_VALUE_CHARS = 2000
# Fields and samples of every variable share this; the browser reads the report whole.
EXPLORER_BUDGET_BYTES = 768 * 1024
# reprlib bounds the work: a huge list is never fully formatted. Nesting can still multiply
# its limits, so the text is cut as well.
_VALUE_REPR = reprlib.Repr(maxlevel=2, maxlist=20, maxdict=20, maxstring=200, maxother=1000)


def _interface(
    source: str,
    values: dict[str, Any],
    namespace: dict[str, Any],
    provided: set[str],
    passed_on: set[str],
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
            {"name": n, "origin": "inferred", "bound": n in provided}
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
        "outputs": _candidates_within_budget(candidates, namespace, passed_on),
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
    names: list[str], namespace: dict[str, Any], passed_on: set[str]
) -> list[dict[str, Any]]:
    """Each variable for the Data tab's explorer (ADR-0030). Fields and samples are added in
    order while they fit the budget, so many large tables cannot make the report unreadable."""
    left = EXPLORER_BUDGET_BYTES
    found = []
    for name in names:
        doc, extras = _candidate(name, namespace[name], name in passed_on)
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
    frame = as_polars(value)
    if frame is None:
        doc["text"] = cut(_VALUE_REPR.repr(value), MAX_VALUE_CHARS)
        return doc, {}
    doc["rows"], doc["columns"] = frame.height, frame.width
    nulls = frame.select(frame.columns[:MAX_FIELDS]).null_count().row(0)
    fields = [
        {"name": n, "data_type": str(t), "null_count": c}
        for (n, t), c in zip(list(frame.schema.items())[:MAX_FIELDS], nulls, strict=True)
    ]
    return doc, {"fields": fields, "sample": table_page(frame, MAX_SAMPLE_ROWS)}


def _run(
    source: str, values: dict[str, Any], provided: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run the code with `provided` in scope, like a notebook cell: what it prints, shows and
    draws is collected in order. Returns that display and the namespace it ended with."""
    shown = _Collector()
    namespace: dict[str, Any] = {
        "__name__": "__sprisk_code__",
        **provided,
        "display": shown.display,
    }
    plt.close("all")
    real_show = plt.show

    def show(*_: Any, **__: Any) -> None:
        shown.open_figures(_code_line())

    plt.show = show  # notebook-style: show() puts open figures here, in order
    plotly_io = _plotly_io()
    real_plotly_show = plotly_io.show if plotly_io else None
    if plotly_io:
        # fig.show() would open a browser from the worker; in a notebook it shows the figure.
        plotly_io.show = lambda fig, *_, **__: shown.display(fig)
    try:
        module = bind(source, values) if values else ast.parse(source, FILENAME)
        shown.labels = _display_labels(module)
        body, last = _split_last_expression(module)
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
        if plotly_io:
            plotly_io.show = real_plotly_show

    if value is not None and last is not None:
        shown.show(value, last.body.lineno, _label(last.body))
    shown.open_figures(None)  # figures never shown by a line, as a notebook shows them at the end
    display = CodeDisplay.model_validate_json(json.dumps({"items": shown.items}))
    return display.model_dump(mode="json", exclude_none=True), namespace


def _label(node: ast.expr) -> str:
    return cut(ast.unparse(node), MAX_LABEL_CHARS)


def _display_labels(module: ast.Module) -> dict[int, list[str]]:
    """The code of each value passed to `display(...)`, by the line of the call, so a shown
    table is named by what the person wrote."""
    return {
        node.lineno: [_label(a) for a in node.args]
        for node in ast.walk(module)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "display"
    }


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
        # The code of each display() argument, by line: what a shown value is called.
        self.labels: dict[int, list[str]] = {}
        # The stream whose printed text the last item holds; further prints to it extend it.
        self.printing: str | None = None

    def _add(self, item: dict[str, Any], line: int | None = None, label: str | None = None) -> None:
        if line is not None:
            item["line"] = line
        if label is not None:
            item["label"] = label
        self.printing = None
        if len(self.items) < MAX_ITEMS:
            self.items.append(item)

    def text(self, chunk: str, channel: str) -> None:
        if self.printing == channel and self.items:
            last = self.items[-1]
            last["text"] = cut(last["text"] + chunk, MAX_TEXT_CHARS)
            return
        self._add({"kind": "text", "text": chunk, "channel": channel})
        self.printing = channel

    def display(self, *values: Any) -> None:
        """`display()` as the step's code calls it; each value names the line that called it."""
        line = _code_line()
        labels = self.labels.get(line, []) if line is not None else []
        for i, value in enumerate(values):
            self.show(value, line, labels[i] if i < len(labels) else None)

    def show(self, value: Any, line: int | None, label: str | None = None) -> None:
        if (frame := as_polars(value)) is not None:
            self._add({"kind": "table", "table": table_page(frame)}, line, label)
        elif not self.figure(value, line):
            self._add({"kind": "text", "text": cut(repr(value), MAX_TEXT_CHARS)}, line, label)

    def figure(self, value: Any, line: int | None) -> bool:
        """Show `value` as a figure, as a notebook would; False when it is not one."""
        item = figure_item(value)
        if item is None:
            return False
        self.figures += 1
        if self.figures == MAX_FIGURES + 1:
            self._add(
                {
                    "kind": "text",
                    "text": f"More than {MAX_FIGURES} figures; the rest are not shown.",
                }
            )
        elif self.figures <= MAX_FIGURES and len(item["content"]) > MAX_FIGURE_BYTES:
            size = len(item["content"])
            self._add(
                {"kind": "text", "text": f"Figure {self.figures} not shown: {size} bytes."}, line
            )
        elif self.figures <= MAX_FIGURES:
            self._add({"kind": "figure", "figure": item}, line)
        # A matplotlib figure, once shown, is closed, so the end of the run does not show it again.
        fig = getattr(value, "figure", value)
        if isinstance(fig, Figure):
            plt.close(fig)
        return True

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

    def open_figures(self, line: int | None) -> None:
        for number in plt.get_fignums():
            self.figure(plt.figure(number), line)


def _code_line() -> int | None:
    """The line of the step's own code that is running now: the innermost frame compiled from
    it. None when called from outside that code."""
    frame: FrameType | None = sys._getframe(1)
    while frame is not None:
        if frame.f_code.co_filename == FILENAME:
            return frame.f_lineno
        frame = frame.f_back
    return None


def _plotly_io() -> Any:
    """plotly.io, or None when plotly is not installed. Any: plotly ships no types."""
    try:
        import plotly.io
    except ImportError:
        return None
    return plotly.io


class _Stream(io.TextIOBase):
    """stdout or stderr that hands each write to the collector, so prints keep their place."""

    def __init__(self, collector: _Collector, channel: str) -> None:
        self.collector = collector
        self.channel = channel

    def write(self, chunk: str) -> int:
        if chunk:
            self.collector.text(chunk, self.channel)
        return len(chunk)
