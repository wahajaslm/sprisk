"""Compile decorated operators into the Method IR (ADR-0071). The IR is serialized as today's
operator manifest, so Rust reads it unchanged.

Run as `python -m sprisk_workers.build_packs plugins methodology` to write the manifests, or
with `--check` to fail when any is stale. Only first-party packs are imported: building runs
their code, so a third-party pack ships its IR."""

import argparse
import importlib
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

from sprisk_contracts import Operator
from sprisk_workers.authoring import declared, tables
from sprisk_workers.errors import ManifestError
from sprisk_workers.manifests import TRUSTED_PACKAGES
from sprisk_workers.notebook_code import unresolved_names

HEADER = "# Method IR compiled from {ref}. Do not edit; run `just build-packs`.\n"
MARK = "# Method IR compiled from "
JSON_TYPES: dict[Any, str] = {float: "number", int: "integer", str: "string", bool: "boolean"}
RANGE_KEYS = {"minimum": "minimum", "maximum": "maximum", "step": "x-sprisk-step"}


def _json_type(fn: Callable[..., Any], name: str, annotation: Any) -> str:
    if typing.get_origin(annotation) in (typing.Union, types.UnionType):
        options = [a for a in typing.get_args(annotation) if a is not type(None)]
        annotation = options[0] if len(options) == 1 else annotation
    if annotation not in JSON_TYPES:
        shown = getattr(annotation, "__name__", repr(annotation))
        raise ManifestError(f"{fn.__name__}.{name}: {shown} has no JSON type")
    return JSON_TYPES[annotation]


def _params_schema(fn: Callable[..., Any]) -> dict[str, Any]:
    found = declared(fn)
    assert found is not None
    hints = typing.get_type_hints(fn)
    inputs = set(tables(fn))
    properties: dict[str, Any] = {}
    required = []
    for name, param in inspect.signature(fn).parameters.items():
        if name in inputs:
            continue
        if name not in hints:
            raise ManifestError(f"{fn.__name__}.{name}: has no type annotation")
        prop: dict[str, Any] = {"type": _json_type(fn, name, hints[name])}
        if name in found.concepts:
            prop |= {"minLength": 1, "x-sprisk-column": True}
        for key, value in found.tunables.get(name, {}).items():
            if key not in RANGE_KEYS:
                raise ManifestError(f"{fn.__name__}.{name}: unknown tunable {key}")
            prop[RANGE_KEYS[key]] = value
        if param.default is inspect.Parameter.empty:
            required.append(name)
        elif param.default is not None:
            prop["default"] = param.default
        properties[name] = prop
    unknown = (set(found.concepts) | set(found.tunables)) - set(properties)
    if unknown:
        raise ManifestError(f"{fn.__name__}: {sorted(unknown)} are not settings")
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def operator_manifest(fn: Callable[..., Any]) -> Operator:
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
    description = inspect.getdoc(fn)
    if not description:
        raise ManifestError(f"{fn.__name__} has no docstring to describe it")
    pack = fn.__module__.split(".")[0].replace("_", ".")
    ref = f"{fn.__module__}:{fn.__name__}"
    manifest: dict[str, Any] = {
        "schema_version": "sprisk.operator/v1",
        "id": f"{pack}.{found.id}@{found.version}",
        "title": found.id.replace("_", " ").capitalize(),
        "capability_class": found.capability_class,
        "description": description,
        "entrypoint": ref,
        "notebook_code": ref,
        "inputs": [{"name": name, "kind": "table"} for name in found.inputs],
        "outputs": [{"name": name, "kind": "table"} for name in found.outputs],
        "params_schema": _params_schema(fn),
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
    try:
        return Operator.model_validate_json(json.dumps(manifest))
    except ValidationError as e:
        raise ManifestError(f"{ref}: {e}") from e


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


def compile_packs(
    roots: list[Path], trusted: tuple[str, ...] = TRUSTED_PACKAGES
) -> dict[Path, str]:
    """Each decorated operator's manifest text, by the path it belongs at: the pack's
    `operators/<id>/manifest.yaml`."""
    written: dict[Path, str] = {}
    for pyproject in sorted(p for root in roots for p in root.rglob("pyproject.toml")):
        for init in sorted((pyproject.parent / "src").glob("*/__init__.py")):
            if init.parent.name not in trusted:
                continue
            for fn in _operators(init.parent.name):
                found = declared(fn)
                assert found is not None
                path = pyproject.parent / "operators" / found.id / "manifest.yaml"
                if path in written:
                    raise ManifestError(f"{path}: two operators have the id {found.id}")
                if path.exists() and not path.read_text().startswith(MARK):
                    raise ManifestError(
                        f"{path} is written by hand; remove it to compile {fn.__name__}"
                    )
                body = operator_manifest(fn).model_dump(mode="json", exclude_none=True)
                ref = f"{fn.__module__}:{fn.__name__}"
                written[path] = HEADER.format(ref=ref) + yaml.safe_dump(body, sort_keys=False)
    return written


def _generated(roots: list[Path]) -> list[Path]:
    return [
        p for root in roots for p in root.rglob("manifest.yaml") if p.read_text().startswith(MARK)
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
    print(f"{len(written)} operators compiled, {len(behind)} manifests updated")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
