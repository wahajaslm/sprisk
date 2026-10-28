"""Write the YAML Rust reads and the example screen's data, from the decorated pack."""

import inspect
import json
from pathlib import Path
from typing import Any

import polars as pl
import yaml

import validation
from split_method import split
from sprisk import call, decide, method_manifest, notebook_cell, operator_manifest, plots

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


def plot_entry(
    plot: Any, op: Any, step: tuple[Any, Any] | None, settings: dict[str, Any]
) -> dict[str, Any]:
    params = [p for p in inspect.signature(plot).parameters if p not in ("train", "test")]
    labels = [p for p in params if op.__sprisk__["columns"].get(p) == "common.target"]
    # A plot that reads the target would read test labels, so it waits for the final score.
    figure = None if step is None or labels else call(plot, *step, settings).to_json()
    return {
        "name": plot.__name__,
        "title": inspect.getdoc(plot),
        "params": params,
        "definition": without_call(notebook_cell(plot, ["train", "test"], {})),
        "final_only": bool(labels),
        "figure": figure,
    }


def option_entry(option: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    op = split.__sprisk__["options"][option["id"]]
    columns = op.__sprisk__["columns"]
    bound = {name: BINDINGS[c] for name, c in columns.items() if c in BINDINGS}
    needed = [
        c
        for name, c in columns.items()
        if c not in BINDINGS and inspect.signature(op).parameters[name].default is not None
    ]
    step = None if needed else op(ROWS, **bound)
    settings = {**bound, **option["action"]["replace"]["settings"]}
    return {
        "id": option["id"],
        "label": option["label"],
        "operator": op.__name__,
        "columns": columns,
        "unbound": needed,
        "settings": {
            name: prop
            for name, prop in manifest["params_schema"]["properties"].items()
            if name not in columns
        },
        "promises": [p.__sprisk__["text"] for p in op.__sprisk__["promises"]],
        "definition": without_call(notebook_cell(op, ["data"], {})),
        "plots": [plot_entry(plot, op, step, settings) for plot in plots(op)],
    }


def main() -> None:
    OUT.mkdir(exist_ok=True)
    pack, version = validation.PACK, validation.VERSION
    method = method_manifest(split, "methodology.supervised", pack, version)
    manifests = {}
    for op in split.__sprisk__["options"].values():
        manifests[op.__name__] = operator_manifest(op, pack, version)
    for name, manifest in [("split_method", method), *manifests.items()]:
        text = yaml.safe_dump(manifest, sort_keys=False, width=100)
        (OUT / f"{name}.yaml").write_text(
            "# Generated from the decorated pack. Do not edit.\n" + text
        )

    auto = decide(
        split,
        task="classification",
        event_time=BINDINGS.get("common.event_time"),
        item_identity=BINDINGS.get("common.item_identity"),
        target=BINDINGS.get("common.target"),
    )
    screen = {
        "method": {k: method[k] for k in ("name", "question", "activity")},
        "bindings": BINDINGS,
        "auto": {"option": auto.option, "reason": auto.reason},
        "options": [
            option_entry(o, manifests[split.__sprisk__["options"][o["id"]].__name__])
            for o in method["options"]
        ],
        "files": [{"path": path, "text": (HERE / path).read_text()} for path in WRITTEN],
    }
    SCREEN.write_text(json.dumps(screen, indent=2) + "\n")


if __name__ == "__main__":
    main()
