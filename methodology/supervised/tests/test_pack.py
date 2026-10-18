"""The pack entrypoint the worker runs for the Gate B attempt (ADR-0017)."""

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

from sprisk_contracts import MethodologyCheck
from sprisk_supervised.pack import run
from sprisk_workers.errors import OperatorError

PLUGINS = Path(__file__).parents[3] / "plugins"


def inputs_for(evaluators: int) -> dict[str, Any]:
    nodes = [
        {"id": "load", "operator": "sprisk.io.file_source@1.0.0", "params": {}},
        {"id": "split", "operator": "sprisk.validation.random_split@1.0.0", "params": {}},
    ]
    edges = [{"from": "load.data", "to": "split.data"}]
    for i in range(evaluators):
        nodes += [
            {"id": f"m{i}", "operator": "sprisk.ml.linear_model@1.0.0", "params": {}},
            {"id": f"e{i}", "operator": "sprisk.ml.evaluate@1.0.0", "params": {}},
        ]
        edges += [
            {"from": "split.train", "to": f"m{i}.train"},
            {"from": f"m{i}.model", "to": f"e{i}.model"},
            {"from": "split.test", "to": f"e{i}.test"},
        ]
    pipeline = {
        "schema_version": "sprisk.pipeline_version/v1",
        "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "nodes": nodes,
        "edges": edges,
        "created_at": "2026-10-16T10:00:00Z",
    }
    operators = [yaml.safe_load(p.read_text()) for p in sorted(PLUGINS.rglob("manifest.yaml"))]
    return {"pipeline": pipeline, "operators": operators}


@pytest.mark.parametrize(("evaluators", "verdict"), [(1, "pass"), (2, "fail")])
def test_returns_every_rule_result(evaluators: int, verdict: str) -> None:
    leakage, code = (
        MethodologyCheck.model_validate_json(json.dumps(raw))
        for raw in run(**inputs_for(evaluators))
    )
    assert leakage.check.root == "supervised.split_leakage@1.0.0"
    assert leakage.verdict == verdict
    assert code.check.root == "supervised.code_leakage@1.0.0"
    assert code.verdict == "not_assessed"
    assert leakage.id.root.startswith("mck_")
    assert leakage.id != code.id


def test_invalid_pipeline_is_an_operator_error() -> None:
    with pytest.raises(OperatorError) as e:
        run(**{**inputs_for(1), "pipeline": {"nodes": []}})
    assert e.value.code == "invalid_check_input"


def test_pipeline_using_an_unknown_operator_is_an_operator_error() -> None:
    with pytest.raises(OperatorError) as e:
        run(**{**inputs_for(1), "operators": []})
    assert e.value.code == "invalid_check_input"


def test_code_step_without_source_is_an_operator_error() -> None:
    inputs = inputs_for(1)
    inputs["pipeline"]["nodes"].append(
        {"id": "code", "operator": "sprisk.code.python@2.0.0", "params": {}}
    )
    with pytest.raises(OperatorError) as e:
        run(**inputs)
    assert e.value.code == "invalid_check_input"
