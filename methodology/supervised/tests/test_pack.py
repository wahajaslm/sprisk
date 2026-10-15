"""The pack entrypoint the worker runs for the Gate B attempt (ADR-0017)."""

import json
from pathlib import Path

import pytest
import yaml

from sprisk_contracts import MethodologyCheck
from sprisk_supervised.pack import run
from sprisk_workers.errors import OperatorError
from sprisk_workers.output import JSON

PLUGINS = Path(__file__).parents[3] / "plugins"


def write_inputs(tmp_path: Path, evaluators: int) -> dict[str, Path]:
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
    (tmp_path / "pipeline.json").write_text(json.dumps(pipeline))
    (tmp_path / "operators.json").write_text(json.dumps(operators))
    return {"pipeline": tmp_path / "pipeline.json", "operators": tmp_path / "operators.json"}


def checks(out: Path) -> list[MethodologyCheck]:
    return [
        MethodologyCheck.model_validate_json(json.dumps(c)) for c in json.loads(out.read_text())
    ]


@pytest.mark.parametrize(("evaluators", "verdict"), [(1, "pass"), (2, "fail")])
def test_writes_every_rule_result_as_a_json_array(
    tmp_path: Path, evaluators: int, verdict: str
) -> None:
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    [output] = run({}, write_inputs(tmp_path, evaluators), out_dir)
    assert (output.port, output.media_type) == ("checks", JSON)
    [result] = checks(output.path)
    assert result.check.root == "supervised.split_leakage@1.0.0"
    assert result.verdict == verdict
    assert result.id.root.startswith("mck_")


def test_invalid_pipeline_is_an_operator_error(tmp_path: Path) -> None:
    inputs = write_inputs(tmp_path, 1)
    inputs["pipeline"].write_text('{"nodes": []}')
    with pytest.raises(OperatorError) as e:
        run({}, inputs, tmp_path)
    assert e.value.code == "invalid_check_input"


def test_pipeline_using_an_unknown_operator_is_an_operator_error(tmp_path: Path) -> None:
    inputs = write_inputs(tmp_path, 1)
    inputs["operators"].write_text("[]")
    with pytest.raises(OperatorError) as e:
        run({}, inputs, tmp_path)
    assert e.value.code == "invalid_check_input"
