"""The ExecutionPlan Rust compiles for a pipeline, for checks tested without Rust (ADR-0070).

A test fake of sprisk_graph::execution_plan for manifest ports only: a code step's named
ports are Rust's, and are tested there."""

import json
from collections.abc import Mapping

from sprisk_contracts import ExecutionPlan, Operator, PipelineVersion

TRAIN_OUTPUTS = ("train", "train_words")


def plan_of(pipeline: PipelineVersion, operators: Mapping[str, Operator]) -> ExecutionPlan:
    steps = []
    for node in pipeline.nodes:
        fed = sorted(
            (e.to.root.split(".")[1], e.from_.root)
            for e in pipeline.edges
            if e.to.root.split(".")[0] == node.id.root
        )
        op = operators.get(node.operator.root)
        outputs = []
        for port in [] if op is None else op.outputs:
            name = port.name.root
            train_only = op is not None and op.fits_on_train is True and name in TRAIN_OUTPUTS
            rows_from = ["train"] if train_only else [p for p, _ in fed]
            outputs.append(
                {"name": name, "kind": port.model_dump(mode="json")["kind"], "rows_from": rows_from}
            )
        steps.append(
            {
                "node_id": node.id.root,
                "operator": node.operator.root,
                "inputs": [{"port": p, "from": f} for p, f in fed],
                "outputs": outputs,
            }
        )
    raw = {
        "schema_version": "sprisk.execution_plan/v1",
        "pipeline_version_id": pipeline.id.root,
        "steps": steps,
    }
    return ExecutionPlan.model_validate_json(json.dumps(raw))
