import json
from pathlib import Path

import yaml

from sprisk_contracts import MethodologyCheck, Operator, PipelineVersion
from sprisk_supervised.holdout_sealed import holdout_sealed

PLUGINS = Path(__file__).parents[3] / "plugins"
CHECK_ID = "mck_01JABCDEFGHJKMNPQRSTVWXYZ0"
NOW = "2026-10-16T10:00:00Z"

SOURCE = "sprisk.io.file_source@1.0.0"
SPLIT = "sprisk.validation.random_split@1.0.0"
DUMMY = "sprisk.ml.dummy_baseline@1.0.0"
LINEAR = "sprisk.ml.linear_model@1.0.0"
EVAL = "sprisk.ml.evaluate@1.0.0"


def operators() -> dict[str, Operator]:
    ops = {}
    for path in PLUGINS.rglob("manifest.yaml"):
        op = Operator.model_validate_json(json.dumps(yaml.safe_load(path.read_text())))
        ops[op.id.root] = op
    return ops


def pipeline(nodes: dict[str, str], edges: list[tuple[str, str]]) -> PipelineVersion:
    return PipelineVersion.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.pipeline_version/v1",
                "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "nodes": [{"id": n, "operator": op, "params": {}} for n, op in nodes.items()],
                "edges": [{"from": a, "to": b} for a, b in edges],
                "created_at": NOW,
            }
        )
    )


def compare(models: dict[str, str]) -> PipelineVersion:
    """Source → split → each model fit on train → one evaluate per model on split.test."""
    nodes = {"load": SOURCE, "split": SPLIT}
    edges = [("load.data", "split.data")]
    for name, op in models.items():
        nodes[name] = op
        nodes[f"eval_{name}"] = EVAL
        edges += [
            ("split.train", f"{name}.train"),
            (f"{name}.model", f"eval_{name}.model"),
            ("split.test", f"eval_{name}.test"),
        ]
    return pipeline(nodes, edges)


def check(p: PipelineVersion) -> MethodologyCheck:
    result = holdout_sealed(p, operators(), CHECK_ID, NOW)
    # The result is a valid wire record.
    return MethodologyCheck.model_validate_json(result.model_dump_json(by_alias=True))


def test_baseline_plus_one_model_passes() -> None:
    result = check(compare({"dummy": DUMMY, "linear": LINEAR}))
    assert result.verdict == "pass"
    assert result.check.root == "supervised.holdout_sealed@1.0.0"


def test_two_models_on_one_test_table_fail_and_cite_them() -> None:
    result = check(compare({"dummy": DUMMY, "lin_a": LINEAR, "lin_b": LINEAR}))
    assert result.verdict == "fail"
    assert [n.root for n in result.cited_nodes] == ["eval_lin_a", "eval_lin_b", "split"]
    assert "split.test" in result.rationale


def test_two_models_on_separate_test_tables_pass() -> None:
    p = pipeline(
        {
            "load": SOURCE,
            "s1": SPLIT,
            "s2": SPLIT,
            "a": LINEAR,
            "b": LINEAR,
            "ea": EVAL,
            "eb": EVAL,
        },
        [
            ("load.data", "s1.data"),
            ("load.data", "s2.data"),
            ("s1.train", "a.train"),
            ("s2.train", "b.train"),
            ("a.model", "ea.model"),
            ("b.model", "eb.model"),
            ("s1.test", "ea.test"),
            ("s2.test", "eb.test"),
        ],
    )
    assert check(p).verdict == "pass"


def test_same_model_scored_twice_on_one_table_passes() -> None:
    p = compare({"linear": LINEAR})
    p2 = pipeline(
        {**{n.id.root: n.operator.root for n in p.nodes}, "eval_again": EVAL},
        [(e.from_.root, e.to.root) for e in p.edges]
        + [("linear.model", "eval_again.model"), ("split.test", "eval_again.test")],
    )
    assert check(p2).verdict == "pass"


def test_no_evaluator_is_not_assessed() -> None:
    result = check(pipeline({"load": SOURCE}, []))
    assert result.verdict == "not_assessed"
    assert result.cited_nodes == []
