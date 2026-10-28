"""Compile the decorated pack into the Method IR (YAML for now) and the example screen's data."""

import inspect
import json
from pathlib import Path
from typing import Any

import polars as pl
import yaml

import validation
from split_method import split
from sprisk import (
    CONCEPTS,
    call,
    decide,
    decision_record,
    method_manifest,
    notebook_cell,
    operator_manifest,
    verification,
    view_title,
    visualizations,
)

HERE = Path(__file__).parent
OUT = HERE / "generated"
SCREEN = HERE.parents[1] / "apps" / "web" / "src" / "views" / "examples" / "decorator-split.json"
WRITTEN = [
    "split_method.py",
    "validation/group_split.py",
    "validation/temporal_split.py",
    "validation/random_split.py",
    "validation/stratified_split.py",
]
# A Rakuten-shaped project: an item column and a target, no listing time.
BINDINGS = {"common.item_identity": "title_id", "common.target": "product_type"}
ROWS = pl.DataFrame(
    {
        "title_id": [f"t{i // 3 + i % 2}" for i in range(300)],
        "product_type": [f"type{i % 5}" for i in range(300)],
        "price": [float(i % 17) for i in range(300)],
    }
)


def without_call(cell: str) -> str:
    return cell[: cell.rindex("\n\n")].rstrip() + "\n"


def view_entry(
    view: Any, op: Any, step: tuple[Any, Any] | None, settings: dict[str, Any]
) -> dict[str, Any]:
    params = [p for p in inspect.signature(view).parameters if p not in ("train", "test")]
    concepts = op.__sprisk__["concepts"]
    labels = [p for p in params if p in concepts and CONCEPTS[concepts[p]].kind == "label"]
    # A view that reads a label would read test labels, so it waits for the final score.
    figure = None if step is None or labels else call(view, *step, settings).to_json()
    return {
        "name": view.__name__,
        "title": view_title(view),
        "params": params,
        "definition": without_call(notebook_cell(view, ["train", "test"], {})),
        "final_only": bool(labels),
        "figure": figure,
    }


def option_entry(option: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    op = split.__sprisk__["options"][option["id"]].operator
    concepts = op.__sprisk__["concepts"]
    bound = {name: BINDINGS[c] for name, c in concepts.items() if c in BINDINGS}
    unbound = [
        c
        for name, c in concepts.items()
        if c not in BINDINGS and inspect.signature(op).parameters[name].default is not None
    ]
    step = None if unbound else op(ROWS, **bound)
    settings = {**bound, **option["action"]["replace"]["settings"]}
    promises = op.__sprisk__["promises"]
    return {
        "id": option["id"],
        "label": option["label"],
        "operator": op.__name__,
        "implementation": manifest["title"],
        "columns": concepts,
        "unbound": unbound,
        "settings": {
            name: prop
            for name, prop in manifest["params_schema"]["properties"].items()
            if name not in concepts
        },
        "promises": [p.__sprisk__["text"] for p in promises],
        "verifications": []
        if step is None
        else [verification(p, option["id"], *step, settings) for p in promises],
        "definition": without_call(notebook_cell(op, ["data"], {})),
        "plots": [view_entry(view, op, step, settings) for view in visualizations(op)],
    }


def main(out: Path = OUT, screen_path: Path = SCREEN) -> None:
    out.mkdir(exist_ok=True)
    pack, version = validation.PACK, validation.VERSION
    method = method_manifest(split, "methodology.supervised", pack, version)
    manifests = {}
    for choice in split.__sprisk__["options"].values():
        manifests[choice.operator.__name__] = operator_manifest(choice.operator, pack, version)
    for name, manifest in [("split_method", method), *manifests.items()]:
        text = yaml.safe_dump(manifest, sort_keys=False, width=100)
        (out / f"{name}.yaml").write_text(
            "# Method IR, compiled from the decorated pack. Do not edit.\n" + text
        )

    inputs = {
        "task": "classification",
        "event_time": BINDINGS.get("common.event_time"),
        "item_identity": BINDINGS.get("common.item_identity"),
        "target": BINDINGS.get("common.target"),
    }
    decision = decision_record(split, decide(split, **inputs), inputs)
    screen = {
        "method": {k: method[k] for k in ("name", "question", "activity")},
        "bindings": BINDINGS,
        "decision": decision,
        "options": [
            option_entry(o, manifests[split.__sprisk__["options"][o["id"]].operator.__name__])
            for o in method["options"]
        ],
        "files": [{"path": path, "text": (HERE / path).read_text()} for path in WRITTEN],
    }
    screen_path.write_text(json.dumps(screen, indent=2) + "\n")


if __name__ == "__main__":
    main()
