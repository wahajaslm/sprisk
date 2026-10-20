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
CONTRACT = Path(__file__).parents[3] / "tests" / "contract"
QUESTION_ID = "qv_01JABCDEFGHJKMNPQRSTVWXYZ0"


def fixture(entity: str, name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((CONTRACT / entity / "valid" / name).read_text())
    return loaded


def question() -> dict[str, Any]:
    return {**fixture("question_version", "classification-all-fields.json"), "id": QUESTION_ID}


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
    return {"pipeline": pipeline, "operators": operators, "question": None, "decisions": []}


def answering_the_question(inputs: dict[str, Any]) -> dict[str, Any]:
    pipeline = {**inputs["pipeline"], "question_version_id": QUESTION_ID}
    return {**inputs, "pipeline": pipeline, "question": question()}


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


def test_without_a_question_no_check_names_one() -> None:
    checks = run(**inputs_for(1))
    assert all("question_version_id" not in c for c in checks)


def test_every_check_names_the_question_the_pipeline_answers() -> None:
    checks = run(**answering_the_question(inputs_for(1)))
    assert [c["question_version_id"] for c in checks] == [QUESTION_ID, QUESTION_ID]


def test_a_question_other_than_the_pipeline_s_is_an_operator_error() -> None:
    inputs = answering_the_question(inputs_for(1))
    inputs["question"] = {**question(), "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ9"}
    with pytest.raises(OperatorError) as e:
        run(**inputs)
    assert e.value.code == "invalid_check_input"
    assert "qv_01JABCDEFGHJKMNPQRSTVWXYZ9" in e.value.message


def test_a_linked_question_that_was_not_sent_is_an_operator_error() -> None:
    inputs = answering_the_question(inputs_for(1))
    inputs["question"] = None
    with pytest.raises(OperatorError) as e:
        run(**inputs)
    assert e.value.code == "invalid_check_input"


def test_an_invalid_decision_is_an_operator_error() -> None:
    with pytest.raises(OperatorError) as e:
        run(**{**inputs_for(1), "decisions": [{"id": "mdc_x"}]})
    assert e.value.code == "invalid_check_input"
