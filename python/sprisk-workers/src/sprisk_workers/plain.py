"""Run a plain operator function (ADR-0022): inputs and settings in by name, values out.

The function never sees a file. This module reads each input by its port kind, calls the
function, and writes what it returns by the output port's kind."""

import inspect
import io
import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import polars as pl
import skops.io
from sklearn.base import BaseEstimator
from skops.io.exceptions import UntrustedTypesFoundException

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError, OperatorError
from sprisk_workers.output import JSON, PARQUET, SKOPS, Output
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
    settings = set((operator.params_schema.get("properties") or {}).keys())
    _check_signature(fn, operator.id.root, set(inputs), settings)

    def run(params: Mapping[str, Any], paths: Mapping[str, Path], out_dir: Path) -> list[Output]:
        values = {port: _read(paths[port], kind) for port, kind in inputs.items()}
        try:
            result = fn(**values, **params)
        except pl.exceptions.ColumnNotFoundError as e:
            raise OperatorError("missing_column", f"column not found: {_first_line(e)}") from e
        except ValueError as e:
            raise OperatorError("invalid_input", str(e)) from e
        except Exception as e:  # noqa: BLE001 - reported as the attempt's failure, never swallowed
            raise OperatorError("operator_error", f"{type(e).__name__}: {e}") from e
        by_port = result if len(outputs) > 1 else {next(iter(outputs)): result}
        if not isinstance(by_port, dict) or set(by_port) != set(outputs):
            got = sorted(by_port) if isinstance(by_port, dict) else type(by_port).__name__
            raise OperatorError("bad_output", f"expected outputs {sorted(outputs)}, got {got}")
        return [_write(port, by_port[port], kind, out_dir) for port, kind in outputs.items()]

    return run


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


def _read(path: Path, kind: str) -> Any:
    if kind == "table":
        return pl.read_parquet(path)
    if kind == "model":
        try:
            return skops.io.load(path, trusted=TRUSTED_MODEL_TYPES)
        except UntrustedTypesFoundException as e:
            raise OperatorError("untrusted_model", str(e)) from e
    return json.loads(path.read_text())


def _write(port: str, value: Any, kind: str, out_dir: Path) -> Output:
    """A table is Parquet on any port (profiles and histograms are tables too); a model is
    skops; figures are one FigureSet (ADR-0024); anything else is JSON."""
    if kind == "figure":
        figures = value if isinstance(value, list | tuple) else [value]
        path = out_dir / f"{port}.json"
        path.write_text(json.dumps({"items": [_figure(port, f) for f in figures]}))
        return Output(port, path, JSON)
    if kind == "table" and not isinstance(value, pl.DataFrame):
        raise _wrong(port, "a polars DataFrame", value)
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
