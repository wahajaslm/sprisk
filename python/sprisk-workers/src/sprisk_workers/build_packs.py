"""Compile decorated methods, operators and promises into the Method IR (ADR-0071). The IR is
serialized as today's method.yaml and operator manifest.yaml, so Rust reads it unchanged. A
promise becomes the evidence step that checks it.

Run as `python -m sprisk_workers.build_packs plugins methodology` to write the manifests, or
with `--check` to fail when any is stale. Only first-party packs are imported: building runs
their code, so a third-party pack ships its IR."""

import argparse
import ast
import importlib
import importlib.util
import inspect
import json
import pkgutil
import sys
import types
import typing
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from sprisk_contracts import Method, Operator
from sprisk_workers.authoring import (
    declared,
    declared_method,
    declared_promise,
    tables,
)
from sprisk_workers.errors import ManifestError
from sprisk_workers.manifests import TRUSTED_PACKAGES
from sprisk_workers.notebook_code import unresolved_names

HEADER = "# Method IR compiled from {ref}. Do not edit; run `just build-packs`.\n"
MARK = "# Method IR compiled from "
JSON_TYPES: dict[Any, str] = {float: "number", int: "integer", str: "string", bool: "boolean"}
FIELD_TYPES: dict[Any, str] = {**JSON_TYPES, list[str]: "string_list"}
VERDICT_FIELDS = {"status": "string", "detail": "string"}
RANGE_KEYS = {"minimum": "minimum", "maximum": "maximum", "step": "x-sprisk-step"}


def _json_type(fn: Callable[..., Any], name: str, annotation: Any) -> str:
    if typing.get_origin(annotation) in (typing.Union, types.UnionType):
        options = [a for a in typing.get_args(annotation) if a is not type(None)]
        annotation = options[0] if len(options) == 1 else annotation
    if annotation not in JSON_TYPES:
        shown = getattr(annotation, "__name__", repr(annotation))
        raise ManifestError(f"{fn.__name__}.{name}: {shown} has no JSON type")
    return JSON_TYPES[annotation]


def docstring(fn: Callable[..., Any]) -> tuple[str, dict[str, str]]:
    """A function's description, and each setting's from its `Args:` section."""
    text = inspect.getdoc(fn) or ""
    summary, _, args = text.partition("\nArgs:\n")
    described: dict[str, str] = {}
    name = None
    for line in args.splitlines():
        head, colon, rest = line.strip().partition(":")
        if line.startswith("    ") and not line.startswith("        ") and colon:
            name = head
            described[name] = rest.strip()
        elif name is not None and line.strip():
            described[name] += " " + line.strip()
    return " ".join(summary.split()), described


def _params_schema(
    fn: Callable[..., Any],
    concepts: dict[str, str],
    tunables: dict[str, dict[str, float]],
    kinds: dict[str, str],
    exclude_labels: bool = False,
) -> dict[str, Any]:
    hints = typing.get_type_hints(fn)
    inputs = set(tables(fn))
    _, described = docstring(fn)
    properties: dict[str, Any] = {}
    required = []
    for name, param in inspect.signature(fn).parameters.items():
        if name in inputs:
            continue
        if name not in hints:
            raise ManifestError(f"{fn.__name__}.{name}: has no type annotation")
        prop: dict[str, Any] = {"type": _json_type(fn, name, hints[name])}
        if name in described:
            prop["description"] = described.pop(name)
        if name in concepts:
            prop |= {"minLength": 1, "x-sprisk-column": True}
            # A check never reads test labels, so its label column is dropped before it runs.
            if exclude_labels and kinds.get(concepts[name]) == "label":
                prop["x-sprisk-excluded"] = True
        for key, value in tunables.get(name, {}).items():
            if key not in RANGE_KEYS:
                raise ManifestError(f"{fn.__name__}.{name}: unknown tunable {key}")
            prop[RANGE_KEYS[key]] = value
        if param.default is inspect.Parameter.empty:
            required.append(name)
        elif param.default is not None:
            prop["default"] = param.default
        properties[name] = prop
    unknown = (set(concepts) | set(tunables) | set(described)) - set(properties)
    if unknown:
        raise ManifestError(f"{fn.__name__}: {sorted(unknown)} are not settings")
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def _pack(fn: Callable[..., Any]) -> str:
    return fn.__module__.split(".")[0].replace("_", ".")


def _validated(model: Any, body: dict[str, Any], ref: str) -> Any:
    try:
        return model.model_validate_json(json.dumps(body))
    except ValidationError as e:
        raise ManifestError(f"{ref}: {e}") from e


def operator_manifest(fn: Callable[..., Any], kinds: dict[str, str] | None = None) -> Operator:
    found = declared(fn)
    if found is None:
        raise ManifestError(f"{fn.__name__} is not a decorated operator")
    if list(found.inputs) != tables(fn):
        raise ManifestError(
            f"{fn.__name__} declares inputs {list(found.inputs)}; its tables are {tables(fn)}"
        )
    missing = unresolved_names(fn)
    if missing:
        raise ManifestError(
            f"{fn.__name__} uses {missing}, which its notebook cell would not have; "
            "import them or define them inside the function"
        )
    description, _ = docstring(fn)
    if not description:
        raise ManifestError(f"{fn.__name__} has no docstring to describe it")
    ref = f"{fn.__module__}:{fn.__name__}"
    manifest: dict[str, Any] = {
        "schema_version": "sprisk.operator/v1",
        "id": f"{_pack(fn)}.{found.id}@{found.version}",
        "title": found.id.replace("_", " ").capitalize(),
        "capability_class": found.capability_class,
        "description": description,
        "entrypoint": ref,
        "notebook_code": ref,
        "inputs": [{"name": name, "kind": "table"} for name in found.inputs],
        "outputs": [{"name": name, "kind": "table"} for name in found.outputs],
        "params_schema": _params_schema(fn, found.concepts, found.tunables, kinds or {}),
        "effects": "pure",
        "network": "none",
        "resources": found.resources,
    }
    for key, value in (
        ("role", found.role),
        ("folds", found.folds),
        ("role_default", found.role_default or None),
        ("concepts", found.concepts or None),
    ):
        if value is not None:
            manifest[key] = value
    return _validated(Operator, manifest, ref)  # type: ignore[no-any-return]


def promise_id(fn: Callable[..., Any]) -> str:
    """The evidence step's operator id: the pack and the last part of the evidence kind."""
    found = declared_promise(fn)
    assert found is not None
    return f"{_pack(fn)}.{found.evidence.rsplit('.', 1)[-1]}@{found.version}"


def promise_manifest(fn: Callable[..., Any], role: str, kinds: dict[str, str]) -> Operator:
    """The evidence step that checks a promise on the outputs of the step with `role`,
    whatever code made them (ADR-0063)."""
    found = declared_promise(fn)
    if found is None:
        raise ManifestError(f"{fn.__name__} is not a promise")
    ref = f"{fn.__module__}:{fn.__name__}"
    inputs = tables(fn)
    if inputs != ["train", "test"]:
        raise ManifestError(f"{fn.__name__} must take the tables train and test; it takes {inputs}")
    fields = {}
    for name, kind in found.fields.items():
        if kind not in FIELD_TYPES:
            raise ManifestError(f"{fn.__name__}: evidence field {name} has no evidence type")
        fields[name] = FIELD_TYPES[kind]
    manifest: dict[str, Any] = {
        "schema_version": "sprisk.operator/v1",
        "id": promise_id(fn),
        "title": found.title,
        "capability_class": "analyzer",
        "description": docstring(fn)[0] or found.text,
        "entrypoint": ref,
        "attach": {"role": role, "side": "output"},
        "produces": {found.evidence: {"fields": fields | VERDICT_FIELDS}},
        "inputs": [{"name": name, "kind": "table"} for name in inputs],
        "outputs": [{"name": "evidence", "kind": "report"}],
        "params_schema": _params_schema(fn, found.concepts, {}, kinds, exclude_labels=True),
        "effects": "pure",
        "network": "none",
        "resources": {"cpu_cores": 1, "memory_mb": 2048, "gpu": "none", "timeout_seconds": 600},
    }
    if found.concepts:
        manifest["concepts"] = found.concepts
    return _validated(Operator, manifest, ref)  # type: ignore[no-any-return]


def _defaults(op: Callable[..., Any]) -> dict[str, Any]:
    found = declared(op)
    assert found is not None
    return {
        name: p.default
        for name, p in inspect.signature(op).parameters.items()
        if p.default is not inspect.Parameter.empty
        and p.default is not None
        and name not in found.concepts
    }


def _reasons(fn: Callable[..., Any]) -> dict[str, str]:
    """Each option's reason, read from the `method.choose(option, reason=...)` calls in the
    method's file: the option's rationale."""
    module = inspect.getsource(inspect.getmodule(fn))  # type: ignore[arg-type]
    reasons: dict[str, str] = {}
    for node in ast.walk(ast.parse(module)):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "choose"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "method"
        ):
            continue
        given = [k.value for k in node.keywords if k.arg == "reason"]
        first = node.args[0] if node.args else None
        if not (isinstance(first, ast.Constant) and isinstance(first.value, str) and given):
            raise ManifestError(f"{fn.__name__}: method.choose needs an option and a reason")
        if not (isinstance(given[0], ast.Constant) and isinstance(given[0].value, str)):
            raise ManifestError(f"{fn.__name__}: a reason must be plain text")
        option_id, reason = first.value, given[0].value
        if reasons.setdefault(option_id, reason) != reason:
            raise ManifestError(f"{fn.__name__} gives {option_id} two reasons")
    return reasons


def method_manifest(fn: Callable[..., Any], pack: str) -> Method:
    found = declared_method(fn)
    if found is None:
        raise ManifestError(f"{fn.__name__} is not a decorated method")
    ref = f"{fn.__module__}:{fn.__name__}"
    parts = (inspect.getdoc(fn) or "").split("\n\n")
    if len(parts) != 3:
        raise ManifestError(
            f"{ref}: its docstring must be three paragraphs: name, question, pitfall"
        )
    name, question, pitfall = (" ".join(part.split()) for part in parts)
    module = inspect.getmodule(fn)
    methods = [v for v in vars(module).values() if callable(v) and declared_method(v)]
    if len(methods) != 1:
        raise ManifestError(
            f"{fn.__module__} holds {len(methods)} methods; a method file holds one"
        )
    reasons = _reasons(fn)
    options = []
    verifications: dict[str, Any] = {}
    for option_id, choice in found.options.items():
        op = declared(choice.operator)
        assert op is not None
        replace: dict[str, Any] = {
            "role": op.role,
            "operator": f"{_pack(choice.operator)}.{op.id}@{op.version}",
        }
        # The operator maps its own columns to concepts, so the option does not repeat them.
        replace["settings"] = _defaults(choice.operator)
        if option_id not in reasons:
            raise ManifestError(f"{fn.__name__} never chooses {option_id}")
        options.append(
            {
                "id": option_id,
                "label": choice.label,
                "description": docstring(choice.operator)[0],
                "condition": choice.condition,
                "when": choice.when,
                "rationale": reasons[option_id],
                "action": {"replace": replace},
                "verify": [check.__name__ for check in op.promises],
            }
        )
        for check in op.promises:
            promised = declared_promise(check)
            assert promised is not None
            verifications[check.__name__] = {"needs": promised.evidence, "promise": promised.text}
    body: dict[str, Any] = {
        "schema_version": "sprisk.method/v2",
        "id": f"{pack}.{found.id}@{found.version}",
        "decides": found.decides,
        "name": name,
        "activity": found.activity,
        "question": question,
        "pitfall": pitfall,
        "applies_when": found.applies_when,
        "needs": {
            "concepts": list(found.concepts.values()),
            "evidence": [],
            "decisions": list(found.decisions),
        },
        "options": options,
        "verifications": verifications,
        "source": found.source,
    }
    return _validated(Method, body, ref)  # type: ignore[no-any-return]


def _operators(package: str) -> Iterable[Callable[..., Any]]:
    try:
        root = importlib.import_module(package)
        modules = [root] + [
            importlib.import_module(info.name)
            for info in pkgutil.walk_packages(root.__path__, f"{package}.")
        ]
    except ImportError as e:
        raise ManifestError(f"cannot import {package}: {e}") from e
    for module in modules:
        for value in vars(module).values():
            if callable(value) and declared(value) and value.__module__ == module.__name__:
                yield value


def _concept_kinds(roots: list[Path]) -> dict[str, str]:
    kinds: dict[str, str] = {}
    for path in sorted(p for root in roots for p in root.rglob("concepts.yaml")):
        for concept, meaning in (yaml.safe_load(path.read_text()).get("concepts") or {}).items():
            kinds[concept] = meaning["kind"]
    return kinds


def _method_module(path: Path) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(f"sprisk_method_{path.parent.name}", path)
    if spec is None or spec.loader is None:
        raise ManifestError(f"{path}: cannot load")
    module = importlib.util.module_from_spec(spec)
    # Registered so its functions' source can be read back, for the options' rationales.
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except ImportError as e:
        raise ManifestError(f"{path}: cannot import: {e}") from e
    return module


def _text(ref: str, body: Any) -> str:
    dumped = body.model_dump(mode="json", exclude_none=True)
    return HEADER.format(ref=ref) + yaml.safe_dump(dumped, sort_keys=False)


def _claim(written: dict[Path, str], path: Path, text: str, what: str) -> None:
    if path in written:
        raise ManifestError(f"{path}: two {what}s compile to the same file")
    if path.exists() and not path.read_text().startswith(MARK):
        raise ManifestError(f"{path} is written by hand; remove it to compile the {what}")
    written[path] = text


def compile_packs(
    roots: list[Path], trusted: tuple[str, ...] = TRUSTED_PACKAGES
) -> dict[Path, str]:
    """Each compiled file's text, by the path it belongs at: an operator's and a promise's
    `operators/<id>/manifest.yaml` in their pack, a method's `method.yaml` beside its
    `method.py`."""
    kinds = _concept_kinds(roots)
    written: dict[Path, str] = {}
    for pyproject in sorted(p for root in roots for p in root.rglob("pyproject.toml")):
        for init in sorted((pyproject.parent / "src").glob("*/__init__.py")):
            if init.parent.name not in trusted:
                continue
            roles: dict[Callable[..., Any], str] = {}
            for fn in _operators(init.parent.name):
                found = declared(fn)
                assert found is not None
                path = pyproject.parent / "operators" / found.id / "manifest.yaml"
                ref = f"{fn.__module__}:{fn.__name__}"
                _claim(written, path, _text(ref, operator_manifest(fn, kinds)), "operator")
                for check in found.promises:
                    if roles.setdefault(check, found.role or "") != (found.role or ""):
                        raise ManifestError(f"{check.__name__} checks steps of two roles")
            for check, role in roles.items():
                promised = declared_promise(check)
                assert promised is not None
                name = promised.evidence.rsplit(".", 1)[-1]
                path = pyproject.parent / "operators" / name / "manifest.yaml"
                ref = f"{check.__module__}:{check.__name__}"
                _claim(written, path, _text(ref, promise_manifest(check, role, kinds)), "promise")
    for path in sorted(p for root in roots for p in root.rglob("method.py")):
        module = _method_module(path)
        for value in vars(module).values():
            if callable(value) and declared_method(value) and value.__module__ == module.__name__:
                pack = f"{path.parents[3].name}.{path.parents[2].name}"
                ref = f"{path.parent.name}/method.py:{value.__name__}"
                text = _text(ref, method_manifest(value, pack))
                _claim(written, path.with_name("method.yaml"), text, "method")
    return written


def _generated(roots: list[Path]) -> list[Path]:
    return [
        p
        for root in roots
        for name in ("manifest.yaml", "method.yaml")
        for p in root.rglob(name)
        if p.read_text().startswith(MARK)
    ]


def stale(written: dict[Path, str], roots: list[Path]) -> list[Path]:
    """Manifests that are missing, differ from their source, or have no source any more."""
    changed = [p for p, text in written.items() if not p.exists() or p.read_text() != text]
    orphans = [p for p in _generated(roots) if p not in written]
    return sorted(changed + orphans)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="build_packs", description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when a manifest is stale")
    parser.add_argument("roots", nargs="+", type=Path)
    args = parser.parse_args(argv)
    missing = [root for root in args.roots if not root.is_dir()]
    if missing:
        parser.error(f"no such folder: {', '.join(map(str, missing))}")
    roots: list[Path] = args.roots
    written = compile_packs(roots, TRUSTED_PACKAGES)
    behind = stale(written, roots)
    if args.check:
        for path in behind:
            print(f"stale: {path}", file=sys.stderr)
        if behind:
            print("Run `just build-packs` and commit the result.", file=sys.stderr)
        return 1 if behind else 0
    for path in behind:
        if path in written:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(written[path])
        else:
            path.unlink()
    print(f"{len(written)} files compiled, {len(behind)} updated")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
