"""Spike runtime. Python is the authoring format: `@concept`, `@method`, `@operator`, `@promise`
and `@visualization` record what a function declares. A visualization is also found by AST: a
function in an operator's file that returns a view type. The `*_manifest` functions compile
the records into the versioned Method IR; YAML is its current serialization."""

import ast
import hashlib
import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

Fn = Callable[..., Any]

RESOURCES = {"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600}
JSON_TYPES = {float: "number", int: "integer", str: "string"}
# Return types the app can draw: Plotly and Vega-Lite (Altair).
VIEW_TYPES = {"go.Figure", "alt.Chart"}


@dataclass(frozen=True)
class Concept:
    id: str
    kind: str
    description: str
    accepts: tuple[str, ...]


CONCEPTS: dict[str, Concept] = {}


def concept(*, id: str, kind: str, description: str, accepts: list[str]) -> Callable[[type], type]:
    """Define a new reusable meaning. Existing concepts are referenced by id, never redefined."""

    def register(cls: type) -> type:
        if id in CONCEPTS:
            raise ValueError(f"concept {id} is already defined")
        CONCEPTS[id] = Concept(id, kind, description, tuple(accepts))
        return cls

    return register


@concept(
    id="common.item_identity",
    kind="entity_identifier",
    description="Groups rows that describe the same real-world item.",
    accepts=["column", "derived"],
)
class ItemIdentity: ...


@concept(
    id="common.event_time",
    kind="time",
    description="When the event a row describes happened.",
    accepts=["column"],
)
class EventTime: ...


@concept(
    id="common.target",
    kind="label",
    description="The value the model learns to predict.",
    accepts=["column"],
)
class Target: ...


def _concepts(concepts: dict[str, str] | None, columns: dict[str, str] | None) -> dict[str, str]:
    """`columns=` is the short form for concepts bound to a table column."""
    merged = {**(concepts or {}), **(columns or {})}
    for name, concept_id in merged.items():
        if concept_id not in CONCEPTS:
            raise ValueError(f"{name} names concept {concept_id}, which is not defined")
    for name, concept_id in (columns or {}).items():
        if "column" not in CONCEPTS[concept_id].accepts:
            raise ValueError(f"{name}: concept {concept_id} cannot be bound to a column")
    return merged


@dataclass(frozen=True)
class Option:
    label: str
    operator: Fn


def option(label: str, operator: Fn) -> Option:
    """A methodological choice and the operator that carries it out."""
    return Option(label, operator)


@dataclass(frozen=True)
class Choice:
    option: str
    reason: str


@dataclass(frozen=True)
class Verdict:
    status: str
    detail: str
    evidence: dict[str, Any] = field(default_factory=dict)


def _record(**declared: Any) -> Callable[[Fn], Fn]:
    def attach(fn: Fn) -> Fn:
        fn.__sprisk__ = declared  # type: ignore[attr-defined]
        return fn

    return attach


def method(
    *,
    id: str,
    decides: str,
    name: str,
    activity: str,
    question: str,
    applies_when: dict[str, list[str]],
    options: dict[str, Option],
    source: str,
    decisions: list[str] | None = None,
    concepts: dict[str, str] | None = None,
    columns: dict[str, str] | None = None,
) -> Callable[[Fn], Fn]:
    return _record(
        kind="method",
        id=id,
        decides=decides,
        name=name,
        activity=activity,
        question=question,
        applies_when=applies_when,
        options=options,
        source=source,
        decisions=decisions or [],
        concepts=_concepts(concepts, columns),
    )


method.choose = Choice  # type: ignore[attr-defined]


def operator(
    *,
    id: str,
    inputs: list[str],
    outputs: list[str],
    role: str,
    folds: str,
    concepts: dict[str, str] | None = None,
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
        concepts=_concepts(concepts, columns),
        tunables=tunables or {},
        promises=promises or [],
        role_default=role_default,
    )


def promise(*, id: str, text: str) -> Callable[[Fn], Fn]:
    return _record(kind="promise", id=id, text=text)


def visualization(*, title: str | None = None) -> Callable[[Fn], Fn]:
    return _record(kind="visualization", title=title)


def decide(fn: Fn, **inputs: Any) -> Choice:
    """What the engine does with a method: call it, then refuse an answer it did not declare."""
    choice: Choice = fn(**inputs)
    if choice.option not in fn.__sprisk__["options"]:  # type: ignore[attr-defined]
        raise ValueError(f"{fn.__name__} chose {choice.option!r}, which is not one of its options")
    return choice


def decision_record(fn: Fn, choice: Choice, inputs: dict[str, Any]) -> dict[str, Any]:
    """What Rust stores: the same inputs and the same code always give the same choice."""
    chosen: Option = fn.__sprisk__["options"][choice.option]  # type: ignore[attr-defined]
    return {
        "method": fn.__sprisk__["id"],  # type: ignore[attr-defined]
        "option": choice.option,
        "label": chosen.label,
        "operator": chosen.operator.__sprisk__["id"],
        "reason": choice.reason,
        "inputs": inputs,
        "code": hashlib.sha256(inspect.getsource(fn).encode()).hexdigest()[:12],
    }


def call(fn: Fn, train: Any, test: Any, settings: dict[str, Any]) -> Any:
    """Run a promise or a visualization on a step's outputs, with the settings it names."""
    names = inspect.signature(fn).parameters
    return fn(train, test, **{k: v for k, v in settings.items() if k in names})


def verification(
    check: Fn, option_id: str, train: Any, test: Any, settings: dict[str, Any]
) -> dict[str, Any]:
    """A promise's result, recorded against the decision option it verifies."""
    verdict: Verdict = call(check, train, test, settings)
    return {
        "option": option_id,
        "promise": check.__sprisk__["id"],  # type: ignore[attr-defined]
        "text": check.__sprisk__["text"],  # type: ignore[attr-defined]
        "status": verdict.status,
        "detail": verdict.detail,
        "evidence": verdict.evidence,
    }


def visualizations(op: Fn) -> list[Fn]:
    """The operator file's views, in file order: marked `@visualization`, or found by AST
    because they return a view type."""
    module = inspect.getmodule(op)
    tree = ast.parse(inspect.getsource(module))  # type: ignore[arg-type]
    found = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        marked = any(
            ast.unparse(d.func if isinstance(d, ast.Call) else d) == "visualization"
            for d in node.decorator_list
        )
        returns_view = node.returns is not None and ast.unparse(node.returns) in VIEW_TYPES
        if marked or returns_view:
            found.append(getattr(module, node.name))
    return found


def view_title(view: Fn) -> str:
    declared = getattr(view, "__sprisk__", {})
    return declared.get("title") or inspect.getdoc(view) or view.__name__


def _defaults(op: Fn) -> dict[str, Any]:
    concepts = op.__sprisk__["concepts"]  # type: ignore[attr-defined]
    return {
        name: p.default
        for name, p in inspect.signature(op).parameters.items()
        if p.default is not inspect.Parameter.empty
        and p.default is not None
        and name not in concepts
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
            annotation = next(
                (a for a in getattr(annotation, "__args__", ()) if a is not type(None)), annotation
            )
        if annotation not in JSON_TYPES:
            raise TypeError(f"{op.__name__}.{name}: annotation {p.annotation!r} has no JSON type")
        prop: dict[str, Any] = {"type": JSON_TYPES[annotation]}
        if name in declared["concepts"]:
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
        "concepts": declared["concepts"],
        "promises": [p.__sprisk__["id"] for p in declared["promises"]],
        "visualizations": [{"id": v.__name__, "title": view_title(v)} for v in visualizations(op)],
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
    for option_id, choice in declared["options"].items():
        op = choice.operator
        replace: dict[str, Any] = {
            "role": op.__sprisk__["role"],
            "operator": f"{operator_pack}.{op.__sprisk__['id']}@{version}",
        }
        if op.__sprisk__["concepts"]:
            replace["concepts"] = op.__sprisk__["concepts"]
        replace["settings"] = _defaults(op)
        promises = op.__sprisk__["promises"]
        options.append(
            {
                "id": option_id,
                "label": choice.label,
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
            "concepts": list(declared["concepts"].values()),
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
    used = {n.id for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Name)}
    imports = [
        ast.unparse(node)
        for node in ast.parse(inspect.getsource(module)).body  # type: ignore[arg-type]
        if isinstance(node, ast.Import | ast.ImportFrom)
        and getattr(node, "module", None) != "sprisk"
        and any((a.asname or a.name).split(".")[0] in used for a in node.names)
    ]
    call_args = ", ".join([*args, *(f"{k}={v!r}" for k, v in settings.items())])
    target = f"{result} = " if result else ""
    return "\n".join(imports) + f"\n\n\n{source}\n\n{target}{fn.__name__}({call_args})\n"
