"""Spike runtime. `@method`, `@operator` and `@promise` record what a function declares. Plots
are found by AST: a function in an operator's file that returns `go.Figure`. The `*_manifest`
functions write today's YAML shapes, so Rust keeps reading YAML."""

import ast
import inspect
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

Fn = Callable[..., Any]

RESOURCES = {"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600}
JSON_TYPES = {float: "number", int: "integer", str: "string"}


@dataclass(frozen=True)
class Choice:
    option: str
    reason: str


def _record(**declared: Any) -> Callable[[Fn], Fn]:
    def attach(fn: Fn) -> Fn:
        fn.__sprisk__ = declared  # type: ignore[attr-defined]
        return fn

    return attach


def method(**declared: Any) -> Callable[[Fn], Fn]:
    return _record(kind="method", **declared)


method.choose = Choice  # type: ignore[attr-defined]


def operator(
    *,
    id: str,
    inputs: list[str],
    outputs: list[str],
    role: str,
    folds: str,
    columns: dict[str, str] | None = None,
    tunables: dict[str, dict[str, float]] | None = None,
    promises: list[Fn] | None = None,
    role_default: bool = False,
) -> Callable[[Fn], Fn]:
    return _record(
        kind="operator",
        id=id,
        inputs=inputs,
        outputs=outputs,
        role=role,
        folds=folds,
        columns=columns or {},
        tunables=tunables or {},
        promises=promises or [],
        role_default=role_default,
    )


def promise(*, id: str, text: str) -> Callable[[Fn], Fn]:
    return _record(kind="promise", id=id, text=text)


def decide(fn: Fn, **values: Any) -> Choice:
    """What the engine does with a method: call it, then refuse an answer it did not declare."""
    choice: Choice = fn(**values)
    if choice.option not in fn.__sprisk__["options"]:  # type: ignore[attr-defined]
        raise ValueError(f"{fn.__name__} chose {choice.option!r}, which is not one of its options")
    return choice


def plots(op: Fn) -> list[Fn]:
    """The functions in the operator's file that return `go.Figure`, read by AST."""
    module = inspect.getmodule(op)
    tree = ast.parse(inspect.getsource(module))  # type: ignore[arg-type]
    return [
        getattr(module, node.name)
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.returns is not None
        and ast.unparse(node.returns) == "go.Figure"
    ]


def call(fn: Fn, train: Any, test: Any, settings: dict[str, Any]) -> Any:
    """Run a promise or a plot on a step's outputs, with the settings it names."""
    names = inspect.signature(fn).parameters
    return fn(train, test, **{k: v for k, v in settings.items() if k in names})


def _defaults(op: Fn) -> dict[str, Any]:
    columns = op.__sprisk__["columns"]  # type: ignore[attr-defined]
    return {
        name: p.default
        for name, p in inspect.signature(op).parameters.items()
        if p.default is not inspect.Parameter.empty
        and p.default is not None
        and name not in columns
    }


def _params_schema(op: Fn) -> dict[str, Any]:
    declared = op.__sprisk__  # type: ignore[attr-defined]
    properties: dict[str, Any] = {}
    required = []
    for name, p in inspect.signature(op).parameters.items():
        if name in declared["inputs"]:
            continue
        annotation = p.annotation
        if annotation not in JSON_TYPES:  # `str | None`
            (annotation,) = [a for a in annotation.__args__ if a is not type(None)]
        prop: dict[str, Any] = {"type": JSON_TYPES[annotation]}
        if name in declared["columns"]:
            prop |= {"minLength": 1, "x-sprisk-column": True}
        for key, value in declared["tunables"].get(name, {}).items():
            prop["x-sprisk-step" if key == "step" else key] = value
        if p.default is inspect.Parameter.empty:
            required.append(name)
        elif p.default is not None:
            prop["default"] = p.default
        properties[name] = prop
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def operator_manifest(op: Fn, pack: str, version: str) -> dict[str, Any]:
    declared = op.__sprisk__  # type: ignore[attr-defined]
    manifest: dict[str, Any] = {
        "schema_version": "sprisk.operator/v1",
        "id": f"{pack}.{declared['id']}@{version}",
        "title": declared["id"].replace("_", " ").capitalize(),
        "capability_class": "transform",
        "role": declared["role"],
        "folds": declared["folds"],
        "description": inspect.getdoc(op),
        "entrypoint": f"{op.__module__}:{op.__name__}",
        "inputs": [{"name": n, "kind": "table"} for n in declared["inputs"]],
        "outputs": [{"name": n, "kind": "table"} for n in declared["outputs"]],
        # The YAML key stays `concepts`: that is the contract Rust reads today.
        "concepts": declared["columns"],
        "promises": [p.__sprisk__["id"] for p in declared["promises"]],
        "plots": [{"id": p.__name__, "title": inspect.getdoc(p)} for p in plots(op)],
        "params_schema": _params_schema(op),
        "effects": "pure",
        "network": "none",
        "resources": RESOURCES,
    }
    if declared["role_default"]:
        manifest["role_default"] = True
    return manifest


def method_manifest(fn: Fn, pack: str, operator_pack: str, version: str) -> dict[str, Any]:
    declared = fn.__sprisk__  # type: ignore[attr-defined]
    options = []
    verifications: dict[str, Any] = {}
    for option_id, op in declared["options"].items():
        replace: dict[str, Any] = {
            "role": op.__sprisk__["role"],
            "operator": f"{operator_pack}.{op.__sprisk__['id']}@{version}",
        }
        if op.__sprisk__["columns"]:
            replace["concepts"] = op.__sprisk__["columns"]
        replace["settings"] = _defaults(op)
        promises = op.__sprisk__["promises"]
        options.append(
            {
                "id": option_id,
                "label": op.__sprisk__["id"].replace("_", " ").capitalize(),
                "action": {"replace": replace},
                "verify": [p.__sprisk__["id"] for p in promises],
            }
        )
        for p in promises:
            verifications[p.__sprisk__["id"]] = {"promise": p.__sprisk__["text"]}
    return {
        "schema_version": "sprisk.method/v2",
        "id": f"{pack}.{declared['id']}@{version}",
        "decides": declared["decides"],
        "name": declared["name"],
        "activity": declared["activity"],
        "question": declared["question"],
        "applies_when": declared["applies_when"],
        "needs": {
            "concepts": list(declared["columns"].values()),
            "evidence": [],
            "decisions": declared["decisions"],
        },
        "options": options,
        "verifications": verifications,
        "source": declared["source"],
    }


def notebook_cell(fn: Fn, args: list[str], settings: dict[str, Any], result: str = "") -> str:
    """The function as plain Python, without its decorator, plus one call. It replaces each
    operator's hand-written `as_code`."""
    module = inspect.getmodule(fn)
    source = inspect.getsource(fn)
    source = source[source.index("def ") :]
    imports = [
        line
        for line in inspect.getsource(module).splitlines()  # type: ignore[arg-type]
        if line.startswith(("import ", "from "))
        and not line.startswith("from sprisk ")
        and re.search(rf"\b{re.escape(line.split()[-1])}\b", source)
    ]
    call_args = ", ".join([*args, *(f"{k}={v!r}" for k, v in settings.items())])
    target = f"{result} = " if result else ""
    return "\n".join(imports) + f"\n\n\n{source}\n\n{target}{fn.__name__}({call_args})\n"
