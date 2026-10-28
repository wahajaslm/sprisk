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
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

import polars as pl
import skops.io
from jsonschema import Draft202012Validator
from sklearn.base import BaseEstimator, TransformerMixin
from skops.io.exceptions import UntrustedTypesFoundException

from sprisk_contracts import Operator
from sprisk_workers.errors import ManifestError, OperatorError
from sprisk_workers.matrix import Matrix, read_matrix, write_matrix
from sprisk_workers.output import CONSOLE_PORT, JSON, MATRIX, PARQUET, SKOPS, Output
from sprisk_workers.serve import OperatorFn

# skops trusts scikit-learn estimators by default. Anything beyond them and this list fails
# to load, so a tampered model file cannot run arbitrary code.
# Tree storage is listed so forests load: a forged tree could make predict read out of bounds,
# but model files are written only by first-party steps into the content-addressed store, and
# every input's hash is checked against the recorded one before it is loaded (serve.py).
# numpy.dtype is listed because fitted imputers and encoders store dtypes.
# Never list a function: skops lets a file call a trusted name and set the result's state.
TRUSTED_MODEL_TYPES = ["numpy.dtype", "sklearn.tree._tree.Tree"]


@dataclass(frozen=True)
class CheckedFunction:
    """A function another step may be handed, and the params it accepts: a model operator's
    unfitted-estimator function (ADR-0046), or a preparation step's own function (ADR-0050)."""

    build: Callable[..., Any]
    params_schema: Mapping[str, Any]


NONE: Mapping[str, CheckedFunction] = MappingProxyType({})


class FoldStep(TransformerMixin, BaseEstimator):  # type: ignore[misc]
    """A preparation step that fits on train (`fits_on_train`) as a scikit-learn transformer,
    so cross-validation refits it per fold with the step's own code (ADR-0050). Fitting keeps
    the rows it is fit on; transforming runs the step with those rows as train.

    A step that makes words (ADR-0058) passes on `(table, words)`, its test table and test
    words; steps after it transform the table and carry the words along unchanged."""

    def __init__(self, step: Callable[..., Any], settings: Mapping[str, Any]) -> None:
        self.step = step
        self.settings = settings

    def fit(self, x: Any, y: Any = None) -> "FoldStep":
        self.train_ = x
        return self

    def transform(self, x: Any) -> Any:
        train, _ = _table_and_words(self.train_)
        test, words = _table_and_words(x)
        out = self.step(train=train, test=test, **self.settings)
        if "test_words" in out:
            if words is not None:
                raise ValueError("only one step may make words for a model")
            return out["test"], out["test_words"]
        return out["test"] if words is None else (out["test"], words)


def _table_and_words(x: Any) -> tuple[Any, Any]:
    return x if isinstance(x, tuple) else (x, None)


def adapt(
    fn: Callable[..., Any],
    operator: Operator,
    models: Mapping[str, CheckedFunction] = NONE,
    preparations: Mapping[str, CheckedFunction] = NONE,
) -> OperatorFn:
    """Check `fn`'s arguments against the manifest now, and return the worker's runner.
    `models` are the estimators a setting marked `x-sprisk-model-operator` may name;
    `preparations` the steps a setting marked `x-sprisk-preparation` may list."""
    inputs = {p.name.root: p.kind.value for p in operator.inputs}
    optional = {p.name.root for p in operator.inputs if p.optional}
    outputs = {p.name.root: p.kind.value for p in operator.outputs}
    properties: Mapping[str, Any] = operator.params_schema.get("properties") or {}
    settings = set(properties)
    _check_signature(fn, operator.id.root, set(inputs), settings)
    named_models = model_settings(operator)
    for setting, params_setting in named_models.items():
        if params_setting not in settings:
            raise ManifestError(
                f"{operator.id.root}: {setting} names {params_setting}, which is not a setting"
            )
    # A file the step reads is an input (ADR-0025): typed Path in the code, marked in the manifest.
    files = {
        k
        for k, v in properties.items()
        if isinstance(v, Mapping) and v.get("x-sprisk-local-path") is True
    }
    _check_paths(fn, operator.id.root, files)
    # A setting marked excluded names a column the step must never read, such as the target on
    # a check of the test rows (ADR-0064): the column is dropped before the step runs.
    excluded = {
        k
        for k, v in properties.items()
        if isinstance(v, Mapping) and v.get("x-sprisk-excluded") is True
    }
    # A code step's ports can be variable names listed in its params (ADR-0031).
    named_in, named_out = named_ports(operator, "input"), named_ports(operator, "output")

    def run(params: Mapping[str, Any], paths: Mapping[str, Path], out_dir: Path) -> list[Output]:
        unconnected = sorted(set(inputs) - set(paths) - optional)
        if unconnected:
            raise OperatorError("unconnected_input", f"input {unconnected[0]} is not connected")
        # An optional input left unconnected arrives as None (ADR-0058).
        values = {
            port: _read(paths[port], kind) if port in paths else None
            for port, kind in inputs.items()
        }
        dropped = [params[k] for k in excluded if k in params]
        for port, value in values.items():
            if isinstance(value, pl.DataFrame):
                values[port] = value.drop(dropped, strict=False)
        named = named_port_names(operator, params, "output")
        expected = dict(outputs) | {name: "table" for name in named}
        try:
            arguments = {k: Path(v) if k in files else v for k, v in params.items()}
            for setting, params_setting in named_models.items():
                arguments[setting] = _build(params[setting], params[params_setting], models)
            for setting in preparation_settings(operator):
                arguments[setting] = [_fold_step(s, preparations) for s in params[setting]]
            if named_in is not None:
                arguments[named_in] = {
                    n: _read_as_written(paths[n])
                    for n in named_port_names(operator, params, "input")
                }
            with _console() as printed:
                result = fn(**values, **arguments)
        except OperatorError:
            raise  # already says what failed (a code step's code_error, with its line)
        except pl.exceptions.ColumnNotFoundError as e:
            raise OperatorError("missing_column", f"column not found: {_first_line(e)}") from e
        except ValueError as e:
            raise OperatorError("invalid_input", str(e)) from e
        except Exception as e:  # noqa: BLE001 - reported as the attempt's failure, never swallowed
            raise OperatorError("operator_error", f"{type(e).__name__}: {e}") from e
        several = len(expected) > 1 or named_out is not None
        # A decorated operator returns its outputs as a tuple, in manifest order (ADR-0071).
        if several and named_out is None and isinstance(result, tuple):
            if len(result) != len(expected):
                raise OperatorError(
                    "bad_output", f"expected outputs {list(expected)}, got {len(result)} values"
                )
            result = dict(zip(expected, result, strict=True))
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


def model_settings(operator: Operator) -> dict[str, str]:
    """Each setting that names a model operator, with the setting holding that model's params."""
    properties: Mapping[str, Any] = operator.params_schema.get("properties") or {}
    return {
        key: schema["x-sprisk-model-operator"]
        for key, schema in properties.items()
        if isinstance(schema, Mapping) and "x-sprisk-model-operator" in schema
    }


def _build(ref: str, params: Mapping[str, Any], models: Mapping[str, CheckedFunction]) -> Any:
    """The estimator function of model `ref`, once `params` are ones it accepts. The step
    calls it, so a model setting can only name an estimator a manifest declares."""
    model = models.get(ref)
    if model is None:
        raise OperatorError("unknown_model", f"{ref} is not a model this worker can build")
    _check(ref, params, model)
    return model.build


def preparation_settings(operator: Operator) -> list[str]:
    """The settings that list preparation steps to refit per fold (ADR-0050)."""
    properties: Mapping[str, Any] = operator.params_schema.get("properties") or {}
    return [
        key
        for key, schema in properties.items()
        if isinstance(schema, Mapping) and schema.get("x-sprisk-preparation") is True
    ]


def _fold_step(step: Mapping[str, Any], preparations: Mapping[str, CheckedFunction]) -> FoldStep:
    """Preparation step `{operator, params}` as a fold transformer, once its params are ones
    it accepts. Only an operator whose manifest says it fits on train can be one."""
    ref = step["operator"]
    found = preparations.get(ref)
    if found is None:
        raise OperatorError(
            "unknown_preparation", f"{ref} is not a step this worker can refit per fold"
        )
    _check(ref, step["params"], found)
    return FoldStep(found.build, dict(step["params"]))


def _check(ref: str, params: Mapping[str, Any], function: CheckedFunction) -> None:
    errors = sorted(
        e.message for e in Draft202012Validator(function.params_schema).iter_errors(params)
    )
    if errors:
        raise OperatorError("invalid_params", f"{ref}: {'; '.join(errors)}")


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
    if kind == "matrix":
        try:
            matrix = read_matrix(path)
        except ValueError as e:
            raise OperatorError("invalid_input", f"matrix {path.name}: {e}") from e
        return matrix.values, matrix.columns
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
    skops; a matrix is .npz; figures are one FigureSet (ADR-0024); anything else is JSON."""
    if kind == "figure":
        figures = value if isinstance(value, list | tuple) else [value]
        path = out_dir / f"{port}.json"
        path.write_text(json.dumps({"items": [_figure(port, f) for f in figures]}))
        return Output(port, path, JSON)
    if kind == "matrix":
        path = out_dir / f"{port}.npz"
        write_matrix(_matrix(port, value), path)
        return Output(port, path, MATRIX)
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


def _matrix(port: str, value: Any) -> Matrix:
    """A step returns a matrix as a plain pair, so it never imports sprisk (ADR-0022)."""
    if not isinstance(value, tuple) or len(value) != 2:
        raise _wrong(port, "(a SciPy sparse matrix, its column names)", value)
    values, names = value
    try:
        return Matrix(values, tuple(names))
    except (TypeError, ValueError) as e:
        raise OperatorError("bad_output", f"output {port}: {e}") from e


def _wrong(port: str, expected: str, value: Any) -> OperatorError:
    return OperatorError(
        "bad_output", f"output {port}: expected {expected}, got {type(value).__name__}"
    )


def _first_line(e: Exception) -> str:
    return str(e).splitlines()[0] if str(e) else type(e).__name__


def _figure(port: str, figure: Any) -> dict[str, Any]:
    item = figure_item(figure)
    if item is None:
        raise _wrong(port, "a matplotlib, Plotly or Altair figure", figure)
    return item


def figure_item(figure: Any) -> dict[str, Any] | None:
    """A figure as FigureSet JSON, or None when `figure` is not one. Recognised by its library,
    so no plotting library is imported to check. matplotlib becomes SVG (a picture, as in a
    notebook); Plotly and Altair stay data the browser draws live."""
    library = type(figure).__module__.split(".")[0]
    if library in ("matplotlib", "seaborn"):
        # seaborn returns Axes or grids; each knows its matplotlib figure.
        fig = getattr(figure, "figure", figure)
        if not hasattr(fig, "savefig"):
            return None
        buffer = io.StringIO()
        fig.savefig(buffer, format="svg", bbox_inches="tight")
        title = fig.get_suptitle() or next((a.get_title() for a in fig.axes if a.get_title()), "")
        return _item("matplotlib", "svg", buffer.getvalue(), title)
    if library == "plotly" and hasattr(figure, "to_json") and hasattr(figure, "layout"):
        return _item("plotly", "plotly_json", figure.to_json(), figure.layout.title.text)
    if library == "altair" and hasattr(figure, "to_json"):
        spec = figure.to_json()
        title = json.loads(spec).get("title")
        return _item("altair", "vega_lite_json", spec, title if isinstance(title, str) else None)
    return None


def _item(library: str, format: str, content: str, title: str | None) -> dict[str, Any]:
    return {"library": library, "format": format, "content": content} | (
        {"title": title} if title else {}
    )
