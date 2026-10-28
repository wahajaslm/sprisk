"""Spike runtime for packs written with decorators. The code says most of it: table parameters
are inputs, the returned dict's keys are outputs, types carry concepts and ranges, docstrings
describe. A decorator only adds what code cannot say: role, folds, promises. The `*_manifest`
functions turn all of it into today's YAML shapes, so Rust keeps reading YAML."""

import ast
import inspect
import re
import textwrap
import types
import typing
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any

import plotly.graph_objects as go
import polars as pl

Fn = Callable[..., Any]

OPERATOR_RESOURCES = {"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600}
EVIDENCE_RESOURCES = {"cpu_cores": 1, "memory_mb": 1024, "gpu": "none", "timeout_seconds": 300}


@dataclass(frozen=True)
class Concept:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class Between:
    minimum: float
    maximum: float
    step: float | None = None


@dataclass(frozen=True)
class Choice:
    option: str
    reason: str


def choose(option: str, reason: str) -> Choice:
    return Choice(option, reason)


def _record(**declared: Any) -> Callable[[Fn], Fn]:
    def attach(fn: Fn) -> Fn:
        fn.__sprisk__ = declared  # type: ignore[attr-defined]
        return fn

    return attach


def operator(
    *,
    role: str,
    folds: str | None = None,
    promises: list[Fn] | None = None,
    capability_class: str = "transform",
    role_default: bool = False,
    resources: dict[str, Any] | None = None,
) -> Callable[[Fn], Fn]:
    return _record(
        kind="operator",
        role=role,
        folds=folds,
        promises=promises or [],
        capability_class=capability_class,
        role_default=role_default,
        resources=resources or OPERATOR_RESOURCES,
    )


def evidence(
    *, produces: str, title: str, resources: dict[str, Any] | None = None
) -> Callable[[Fn], Fn]:
    return _record(
        kind="evidence", produces=produces, title=title, resources=resources or EVIDENCE_RESOURCES
    )


def promise(*, needs: Fn) -> Callable[[Fn], Fn]:
    return _record(kind="promise", needs=needs)


def method(**declared: Any) -> Callable[[Fn], Fn]:
    return _record(kind="method", **declared)


def decide(fn: Fn, **values: Any) -> Choice:
    """What the engine does with a method: call it, then refuse an answer it did not declare."""
    choice: Choice = fn(**values)
    if choice.option not in fn.__sprisk__["options"]:  # type: ignore[attr-defined]
        raise ValueError(f"{fn.__name__} chose {choice.option!r}, which is not one of its options")
    return choice


def _marker[T](annotation: Any, kind: type[T]) -> T | None:
    """The `kind` marker inside an `Annotated` type, looking through `| None`."""
    if typing.get_origin(annotation) in (typing.Union, types.UnionType):
        found = [_marker(arg, kind) for arg in typing.get_args(annotation)]
        return next((m for m in found if m is not None), None)
    if typing.get_origin(annotation) is Annotated:
        return next((m for m in annotation.__metadata__ if isinstance(m, kind)), None)
    return None


def concept_of(annotation: Any) -> Concept | None:
    return _marker(annotation, Concept)


def _json_type(annotation: Any) -> str:
    if typing.get_origin(annotation) in (typing.Union, types.UnionType):
        (inner,) = [a for a in typing.get_args(annotation) if a is not type(None)]
        return _json_type(inner)
    if typing.get_origin(annotation) is Annotated:
        return _json_type(typing.get_args(annotation)[0])
    if typing.get_origin(annotation) is list:
        return f"{_json_type(typing.get_args(annotation)[0])}_list"
    return {float: "number", int: "integer", str: "string"}[annotation]


def _title(fn: Fn) -> str:
    return fn.__name__.replace("_", " ").capitalize()


def _doc(fn: Fn) -> str:
    return inspect.getdoc(fn) or ""


def _settings(fn: Fn) -> tuple[dict[str, Any], dict[str, str], dict[str, Any]]:
    """A function's non-table parameters as (schema properties, concepts, defaults)."""
    hints = typing.get_type_hints(fn, include_extras=True)
    properties: dict[str, Any] = {}
    concepts: dict[str, str] = {}
    defaults: dict[str, Any] = {}
    for name, param in inspect.signature(fn).parameters.items():
        if hints[name] is pl.DataFrame:
            continue
        prop: dict[str, Any] = {"type": _json_type(hints[name])}
        concept = concept_of(hints[name])
        if concept is not None:
            concepts[name] = concept.id
            prop |= {"minLength": 1, "x-sprisk-column": True}
            # A label is dropped before the step runs, so evidence never reads a test label.
            if concept.kind == "label":
                prop["x-sprisk-excluded"] = True
        between = _marker(hints[name], Between)
        if between is not None:
            prop |= {"minimum": between.minimum, "maximum": between.maximum}
            if between.step is not None:
                prop["x-sprisk-step"] = between.step
        if param.default is not inspect.Parameter.empty and param.default is not None:
            prop["default"] = param.default
            defaults[name] = param.default
        properties[name] = prop
    return properties, concepts, defaults


def _outputs(fn: Fn) -> list[str]:
    """The keys of the dict the function returns, read from its code."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Return):
            if not isinstance(node.value, ast.Dict) or not all(
                isinstance(k, ast.Constant) and isinstance(k.value, str) for k in node.value.keys
            ):
                raise ValueError(f"{fn.__name__} must return a dict literal with named outputs")
            found.add(tuple(k.value for k in node.value.keys))  # type: ignore[union-attr]
    if len(found) != 1:
        raise ValueError(f"{fn.__name__} returns different outputs: {sorted(found)}")
    return list(found.pop())


def _output_kind(fn: Fn) -> str:
    value = typing.get_args(typing.get_type_hints(fn)["return"])[1]
    return "figure" if value is go.Figure else "table"


def _tables(fn: Fn) -> list[str]:
    hints = typing.get_type_hints(fn)
    return [n for n in inspect.signature(fn).parameters if hints[n] is pl.DataFrame]


def _params_schema(fn: Fn, properties: dict[str, Any]) -> dict[str, Any]:
    params = inspect.signature(fn).parameters
    required = [n for n in properties if params[n].default is inspect.Parameter.empty]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def operator_manifest(fn: Fn, pack: str, version: str) -> dict[str, Any]:
    declared = fn.__sprisk__  # type: ignore[attr-defined]
    properties, concepts, _ = _settings(fn)
    manifest: dict[str, Any] = {
        "schema_version": "sprisk.operator/v1",
        "id": f"{pack}.{fn.__name__}@{version}",
        "title": _title(fn),
        "capability_class": declared["capability_class"],
        "role": declared["role"],
        "folds": declared["folds"],
        "description": _doc(fn),
        "entrypoint": f"{fn.__module__}:{fn.__name__}",
        "inputs": [{"name": n, "kind": "table"} for n in _tables(fn)],
        "outputs": [{"name": n, "kind": _output_kind(fn)} for n in _outputs(fn)],
        "concepts": concepts,
        "promises": [p.__name__ for p in declared["promises"]],
        "params_schema": _params_schema(fn, properties),
        "effects": "pure",
        "network": "none",
        "resources": declared["resources"],
    }
    if declared["folds"] is None:
        del manifest["folds"]
    if declared["role_default"]:
        manifest["role_default"] = True
    return manifest


def evidence_manifest(fn: Fn, pack: str, version: str, role: str) -> dict[str, Any]:
    declared = fn.__sprisk__  # type: ignore[attr-defined]
    fields = typing.get_type_hints(typing.get_type_hints(fn)["return"])
    properties, concepts, _ = _settings(fn)
    return {
        "schema_version": "sprisk.operator/v1",
        "id": f"{pack}.{fn.__name__}@{version}",
        "title": declared["title"],
        "capability_class": "analyzer",
        "description": _doc(fn),
        "entrypoint": f"{fn.__module__}:{fn.__name__}",
        "attach": {"role": role, "side": "output"},
        "concepts": concepts,
        "produces": {
            declared["produces"]: {"fields": {k: _json_type(t) for k, t in fields.items()}}
        },
        "inputs": [{"name": n, "kind": "table"} for n in _tables(fn)],
        "outputs": [{"name": "evidence", "kind": "report"}],
        "params_schema": _params_schema(fn, properties),
        "effects": "pure",
        "network": "none",
        "resources": declared["resources"],
    }


def method_manifest(fn: Fn, pack: str, operator_pack: str, version: str) -> dict[str, Any]:
    declared = fn.__sprisk__  # type: ignore[attr-defined]
    hints = typing.get_type_hints(fn, include_extras=True)
    needs = [c.id for c in map(concept_of, hints.values()) if c is not None]
    options = []
    verifications: dict[str, Any] = {}
    for option_id, op in declared["options"].items():
        _, concepts, defaults = _settings(op)
        replace: dict[str, Any] = {
            "role": op.__sprisk__["role"],
            "operator": f"{operator_pack}.{op.__name__}@{version}",
        }
        if concepts:
            replace["concepts"] = concepts
        replace["settings"] = defaults
        promises = op.__sprisk__["promises"]
        options.append(
            {
                "id": option_id,
                "label": _title(op),
                "action": {"replace": replace},
                "verify": [p.__name__ for p in promises],
            }
        )
        for p in promises:
            verifications[p.__name__] = {
                "needs": p.__sprisk__["needs"].__sprisk__["produces"],
                "promise": _doc(p),
            }
    return {
        "schema_version": "sprisk.method/v2",
        "id": f"{pack}.{fn.__name__}@{version}",
        "decides": declared["decides"],
        "name": declared["name"],
        "activity": declared["activity"],
        "question": declared["question"],
        "applies_when": declared["applies_when"],
        "needs": {"concepts": needs, "evidence": [], "decisions": declared["decisions"]},
        "options": options,
        "verifications": verifications,
        "source": declared["source"],
    }


def notebook_cell(fn: Fn, settings: dict[str, Any]) -> str:
    """The step as plain Python: the module's library imports, the function without its
    decorator or Sprisk types, and one call on the notebook's tables of the same names. It
    replaces each operator's hand-written `as_code`."""
    module = inspect.getmodule(fn)
    source = inspect.getsource(fn)
    source = source[source.index("def ") :]
    for name, value in vars(module).items():
        if typing.get_origin(value) is Annotated:
            base = typing.get_args(value)[0].__name__
            source = re.sub(rf"\b{name}\b", base, source)
    ours = ("from sprisk ", "from concepts ", "from validation", "from .")
    imports = [
        line
        for line in inspect.getsource(module).splitlines()  # type: ignore[arg-type]
        if line.startswith(("import ", "from "))
        and not line.startswith(ours)
        and re.search(rf"\b{re.escape(line.split()[-1])}\b", source)
    ]
    args = ", ".join([*_tables(fn), *(f"{k}={v!r}" for k, v in settings.items())])
    outputs = _outputs(fn)
    call = f"{fn.__name__}({args})"
    if len(outputs) == 1:
        run = f"{outputs[0]} = {call}[{outputs[0]!r}]\n{outputs[0]}\n"
    else:
        names = ", ".join(outputs)
        picked = ", ".join(f"step[{n!r}]" for n in outputs)
        run = f"step = {call}\n{names} = {picked}\n"
    return "\n".join(imports) + f"\n\n\n{source}\n\n{run}"
