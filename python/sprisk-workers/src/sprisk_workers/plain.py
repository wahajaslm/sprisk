"""Run a plain operator function (ADR-0022): inputs and settings in by name, values out.

The function never sees a file. This module reads each input by its port kind, calls the
function, and writes what it returns by the output port's kind."""

import contextlib
import inspect
import io
import json
import typing
import warnings
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Any

import polars as pl
import skops.io
from sklearn.base import BaseEstimator
from skops.io.exceptions import UntrustedTypesFoundException

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError, OperatorError
from sprisk_workers.output import CONSOLE_PORT, JSON, PARQUET, SKOPS, Output
from sprisk_workers.serve import OperatorFn

# skops trusts scikit-learn estimators by default. Anything beyond them and this list fails
# to load, so a tampered model file cannot run arbitrary code.
# Tree storage is listed so forests load: a forged tree could make predict read out of bounds,
# but model files are written only by first-party steps into the content-addressed store, and
# every input's hash is checked against the recorded one before it is loaded (serve.py).
TRUSTED_MODEL_TYPES = ["numpy.dtype", "sklearn.tree._tree.Tree"]


def adapt(fn: Callable[..., Any], operator: Operator) -> OperatorFn:
    """Check `fn`'s arguments against the manifest now, and return the worker's runner."""
    inputs = {p.name.root: p.kind.value for p in operator.inputs}
    outputs = {p.name.root: p.kind.value for p in operator.outputs}
    properties: Mapping[str, Any] = operator.params_schema.get("properties") or {}
    settings = set(properties)
    _check_signature(fn, operator.id.root, set(inputs), settings)
    # A file the step reads is an input (ADR-0025): typed Path in the code, marked in the manifest.
    files = {
        k
        for k, v in properties.items()
        if isinstance(v, Mapping) and v.get("x-sprisk-local-path") is True
    }
    _check_paths(fn, operator.id.root, files)
    # A code step's ports can be variable names listed in its params (ADR-0031).
    named_in, named_out = named_ports(operator, "input"), named_ports(operator, "output")

    def run(params: Mapping[str, Any], paths: Mapping[str, Path], out_dir: Path) -> list[Output]:
        values = {port: _read(paths[port], kind) for port, kind in inputs.items()}
        named = named_port_names(operator, params, "output")
        expected = dict(outputs) | {name: "table" for name in named}
        try:
            arguments = {k: Path(v) if k in files else v for k, v in params.items()}
            if named_in is not None:
                arguments[named_in] = {
                    n: _read_as_written(paths[n])
                    for n in named_port_names(operator, params, "input")
                }
            with _console() as printed:
                result = fn(**values, **arguments)
        except pl.exceptions.ColumnNotFoundError as e:
            raise OperatorError("missing_column", f"column not found: {_first_line(e)}") from e
        except ValueError as e:
            raise OperatorError("invalid_input", str(e)) from e
        except Exception as e:  # noqa: BLE001 - reported as the attempt's failure, never swallowed
            raise OperatorError("operator_error", f"{type(e).__name__}: {e}") from e
        several = len(expected) > 1 or named_out is not None
        by_port = result if several else {next(iter(expected)): result}
        if not isinstance(by_port, dict) or set(by_port) != set(expected):
            got = sorted(by_port) if isinstance(by_port, dict) else type(by_port).__name__
            raise OperatorError("bad_output", f"expected outputs {sorted(expected)}, got {got}")
        written = [_write(port, by_port[port], kind, out_dir) for port, kind in expected.items()]
        if printed:
            path = out_dir / f"{CONSOLE_PORT}.json"
            path.write_text(json.dumps({"items": printed}))
            written.append(Output(CONSOLE_PORT, path, JSON))
        return written

    return run


def named_ports(operator: Operator, side: str) -> str | None:
    """The params key listing a step's port names on `side` ("input" or "output"), if any."""
    properties: Mapping[str, Any] = operator.params_schema.get("properties") or {}
    return next(
        (
            key
            for key, schema in properties.items()
            if isinstance(schema, Mapping) and schema.get("x-sprisk-ports") == side
        ),
        None,
    )


def named_port_names(operator: Operator, params: Mapping[str, Any], side: str) -> list[str]:
    """The port names a step's params list on `side` (ADR-0031). Params are schema-checked
    before a step runs, so they are a list of names."""
    key = named_ports(operator, side)
    return list(params.get(key) or []) if key is not None else []


def _check_signature(
    fn: Callable[..., Any], ref: str, inputs: set[str], settings: set[str]
) -> None:
    params = inspect.signature(fn).parameters
    unknown = sorted(set(params) - inputs - settings)
    if unknown:
        raise ManifestError(f"{ref}: function takes {unknown}, which the manifest does not declare")
    missing = sorted(inputs - set(params))
    if missing:
        raise ManifestError(f"{ref}: function does not take input ports {missing}")


class _Channel(io.TextIOBase):
    """stdout or stderr of a step: each write becomes one console item, in order."""

    def __init__(self, items: list[dict[str, str]], channel: str) -> None:
        self._items, self._channel = items, channel

    def write(self, text: str) -> int:
        last = self._items[-1] if self._items else None
        if last is not None and last["channel"] == self._channel:
            last["text"] += text  # print() writes in pieces; one item per run of output
        elif text:
            self._items.append({"kind": "text", "channel": self._channel, "text": text})
        return len(text)


@contextlib.contextmanager
def _console() -> Iterator[list[dict[str, str]]]:
    """Everything the step prints or warns, in the CodeDisplay format (text items)."""
    items: list[dict[str, str]] = []
    err = _Channel(items, "stderr")

    def show(
        message: Warning | str,
        category: type[Warning],
        filename: str,
        lineno: int,
        file: typing.TextIO | None = None,
        line: str | None = None,
    ) -> None:
        err.write(f"{category.__name__}: {message}\n")

    with (
        contextlib.redirect_stdout(_Channel(items, "stdout")),
        contextlib.redirect_stderr(err),
        warnings.catch_warnings(),
    ):
        warnings.simplefilter("default")
        warnings.showwarning = show
        yield items


def _check_paths(fn: Callable[..., Any], ref: str, marked: set[str]) -> None:
    hints = typing.get_type_hints(fn)
    typed = {name for name, hint in hints.items() if hint is Path or Path in typing.get_args(hint)}
    unmarked = sorted(typed - marked)
    if unmarked:
        raise ManifestError(
            f"{ref}: {unmarked} are files the step reads; mark them x-sprisk-local-path"
        )
    untyped = sorted(marked - typed)
    if untyped:
        raise ManifestError(
            f"{ref}: {untyped} are marked local paths; type them pathlib.Path in the code"
        )


def _read(path: Path, kind: str) -> Any:
    if kind == "table":
        return pl.read_parquet(path)
    if kind == "model":
        try:
            return skops.io.load(path, trusted=TRUSTED_MODEL_TYPES)
        except UntrustedTypesFoundException as e:
            raise OperatorError("untrusted_model", str(e)) from e
    return json.loads(path.read_text())


def _read_as_written(path: Path) -> Any:
    """A table for a code step, in the library that wrote it: pandas writes its own metadata
    into the file. Built-in steps always read polars (`_read`)."""
    import pyarrow.parquet as pq

    if b"pandas" in (pq.read_schema(path).metadata or {}):
        return pq.read_table(path).to_pandas()
    return pl.read_parquet(path)


def _is_pandas_frame(value: Any) -> bool:
    # Checked by name: pandas is imported only by code that made one.
    kind = type(value)
    return kind.__name__ == "DataFrame" and kind.__module__.split(".")[0] == "pandas"


def _write(port: str, value: Any, kind: str, out_dir: Path) -> Output:
    """A table is Parquet on any port (profiles and histograms are tables too); a model is
    skops; figures are one FigureSet (ADR-0024); anything else is JSON."""
    if kind == "figure":
        figures = value if isinstance(value, list | tuple) else [value]
        path = out_dir / f"{port}.json"
        path.write_text(json.dumps({"items": [_figure(port, f) for f in figures]}))
        return Output(port, path, JSON)
    if kind == "table" and _is_pandas_frame(value):
        path = out_dir / f"{port}.parquet"
        value.to_parquet(path)
        return Output(port, path, PARQUET)
    if kind == "table" and not isinstance(value, pl.DataFrame):
        raise _wrong(port, "a DataFrame", value)
    if isinstance(value, pl.DataFrame) and kind != "model":
        path = out_dir / f"{port}.parquet"
        value.write_parquet(path)
        return Output(port, path, PARQUET)
    if kind == "model":
        if not isinstance(value, BaseEstimator):
            raise _wrong(port, "a scikit-learn estimator", value)
        path = out_dir / f"{port}.skops"
        skops.io.dump(value, path)
        return Output(port, path, SKOPS)
    path = out_dir / f"{port}.json"
    try:
        path.write_text(json.dumps(value))
    except TypeError as e:
        raise _wrong(port, "JSON (dicts, lists, numbers, text)", value) from e
    return Output(port, path, JSON)


def _wrong(port: str, expected: str, value: Any) -> OperatorError:
    return OperatorError(
        "bad_output", f"output {port}: expected {expected}, got {type(value).__name__}"
    )


def _first_line(e: Exception) -> str:
    return str(e).splitlines()[0] if str(e) else type(e).__name__


def _figure(port: str, figure: Any) -> dict[str, Any]:
    """One figure as FigureSet JSON, recognised by its library (no import needed to check)."""
    library = type(figure).__module__.split(".")[0]
    if library in ("matplotlib", "seaborn"):
        # seaborn returns Axes or grids; each knows its matplotlib figure.
        fig = getattr(figure, "figure", figure)
        buffer = io.StringIO()
        fig.savefig(buffer, format="svg", bbox_inches="tight")
        title = fig.get_suptitle() or next((a.get_title() for a in fig.axes if a.get_title()), "")
        return _item("matplotlib", "svg", buffer.getvalue(), title)
    if library == "plotly":
        layout_title = figure.layout.title.text
        return _item("plotly", "plotly_json", figure.to_json(), layout_title)
    raise _wrong(port, "a matplotlib or Plotly figure", figure)


def _item(library: str, format: str, content: str, title: str | None) -> dict[str, Any]:
    return {"library": library, "format": format, "content": content} | (
        {"title": title} if title else {}
    )
