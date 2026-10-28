"""Write the YAML Rust reads and the notebook cells the UI shows, from the decorated pack."""

import inspect
import json
from pathlib import Path
from typing import Any

import polars as pl
import yaml

import validation
from split_method import split_method
from sprisk import (
    decide,
    evidence_manifest,
    method_manifest,
    notebook_cell,
    operator_manifest,
)
from validation import group_split, random_split, stratified_split, temporal_split
from validation.group_split import group_overlap
from validation.row_overlap import row_overlap
from validation.split_chart import split_chart
from validation.temporal_split import time_order

HERE = Path(__file__).parent
OUT = HERE / "generated"
SCREEN = HERE.parents[1] / "apps" / "web" / "src" / "views" / "examples" / "decorator-split.json"
# A Rakuten-shaped project: an item column and a target, no event time.
BINDINGS = {"common.item_identity": "title_id", "common.target": "product_type"}
WRITTEN = [
    "split_method.py",
    "validation/group_split.py",
    "validation/temporal_split.py",
    "validation/stratified_split.py",
    "validation/random_split.py",
    "validation/row_overlap.py",
    "validation/split_chart.py",
    "validation/settings.py",
    "concepts.py",
]
# A small Rakuten-shaped table: titles repeat, five product types, no listing time.
ROWS = pl.DataFrame(
    {
        "title_id": [f"t{i // 3 + i % 2}" for i in range(300)],
        "product_type": [f"type{i % 5}" for i in range(300)],
        "price": [float(i % 17) for i in range(300)],
    }
)
# The settings a Rakuten-shaped project binds; the method never names these columns.
CELLS = {
    "temporal": (temporal_split, {"time_column": "listed_at", "test_fraction": 0.2}),
    "item_groups": (group_split, {"group_column": "title_id", "test_fraction": 0.2, "seed": 42}),
    "stratified_random": (
        stratified_split,
        {"stratify": "product_type", "test_fraction": 0.2, "seed": 42},
    ),
    "simple_random": (random_split, {"test_fraction": 0.2, "seed": 42}),
}


def write(name: str, manifest: dict[str, object]) -> None:
    text = "# Generated from the decorated pack. Do not edit.\n" + yaml.safe_dump(
        manifest, sort_keys=False, width=100
    )
    (OUT / name).write_text(text)


def chart(op: Any, concepts: dict[str, str]) -> str | None:
    """The chart step's figure after this split, run in Python at the default settings. None
    when the project has not bound a concept the split needs."""
    params = inspect.signature(op).parameters
    bound = {name: BINDINGS.get(concept) for name, concept in concepts.items()}
    if any(column is None and params[name].default is not None for name, column in bound.items()):
        return None
    split = op(ROWS, **{name: column for name, column in bound.items() if column is not None})
    return str(split_chart(**split)["figure"].to_json())


def screen(method: dict[str, Any], manifests: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Everything the example screen shows, so it repeats nothing by hand."""
    auto = decide(
        split_method,
        task="classification",
        event_time=BINDINGS.get("common.event_time"),
        item_identity=BINDINGS.get("common.item_identity"),
        target=BINDINGS.get("common.target"),
    )
    options = []
    for option in method["options"]:
        op = split_method.__sprisk__["options"][option["id"]]
        manifest = manifests[op.__name__]
        cell = notebook_cell(op, {})
        options.append(
            {
                "id": option["id"],
                "label": option["label"],
                "operator": op.__name__,
                "definition": cell[: cell.rindex("\n\n")].rstrip() + "\n",
                "outputs": [o["name"] for o in manifest["outputs"]],
                "concepts": manifest["concepts"],
                "settings": {
                    name: prop
                    for name, prop in manifest["params_schema"]["properties"].items()
                    if name not in manifest["concepts"]
                },
                "promises": [method["verifications"][v]["promise"] for v in option["verify"]],
                "chart": chart(op, manifest["concepts"]),
            }
        )
    files = [
        {"path": path, "kind": "written", "text": (HERE / path).read_text()} for path in WRITTEN
    ]
    files += [
        {"path": f"generated/{path.name}", "kind": "generated", "text": path.read_text()}
        for path in sorted(OUT.glob("*.yaml"))
    ]
    chart_cell = notebook_cell(split_chart, {})
    return {
        "chart_cell": chart_cell,
        "method": {k: method[k] for k in ("name", "question", "activity")},
        "bindings": BINDINGS,
        "auto": {"option": auto.option, "reason": auto.reason},
        "options": options,
        "files": files,
    }


def main() -> None:
    OUT.mkdir(exist_ok=True)
    pack, version = validation.PACK, validation.VERSION
    method = method_manifest(split_method, "methodology.supervised", pack, version)
    write("split_method.yaml", method)
    manifests = {}
    for op in (group_split, temporal_split, random_split, stratified_split, split_chart):
        manifests[op.__name__] = operator_manifest(op, pack, version)
        write(f"{op.__name__}.yaml", manifests[op.__name__])
    for fn in (group_overlap, row_overlap, time_order):
        write(f"{fn.__name__}.yaml", evidence_manifest(fn, pack, version, "split"))
    cells = {option: notebook_cell(op, settings) for option, (op, settings) in CELLS.items()}
    (OUT / "notebook_cells.json").write_text(json.dumps(cells, indent=2) + "\n")
    SCREEN.write_text(json.dumps(screen(method, manifests), indent=2) + "\n")


if __name__ == "__main__":
    main()
