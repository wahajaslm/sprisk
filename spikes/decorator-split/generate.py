"""Write the YAML Rust reads and the notebook cells the UI shows, from the decorated pack."""

import json
from pathlib import Path

import yaml

import validation
from split_method import split_method
from sprisk import evidence_manifest, method_manifest, notebook_cell, operator_manifest
from validation import group_split, random_split, stratified_split, temporal_split
from validation.group_split import group_overlap
from validation.row_overlap import row_overlap
from validation.temporal_split import time_order

OUT = Path(__file__).parent / "generated"
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


def main() -> None:
    OUT.mkdir(exist_ok=True)
    pack, version = validation.PACK, validation.VERSION
    write(
        "split_method.yaml", method_manifest(split_method, "methodology.supervised", pack, version)
    )
    for op in (group_split, temporal_split, random_split, stratified_split):
        write(f"{op.__name__}.yaml", operator_manifest(op, pack, version))
    for fn in (group_overlap, row_overlap, time_order):
        write(f"{fn.__name__}.yaml", evidence_manifest(fn, pack, version, "split"))
    cells = {option: notebook_cell(op, settings) for option, (op, settings) in CELLS.items()}
    (OUT / "notebook_cells.json").write_text(json.dumps(cells, indent=2) + "\n")


if __name__ == "__main__":
    main()
