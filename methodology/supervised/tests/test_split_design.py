"""The split design check: does the pipeline split the way the question's facts require?"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from sprisk_contracts import MethodologyCheck, MethodologyDecision, PipelineVersion, QuestionVersion
from sprisk_supervised.split_design import CHECK, split_design

CONTRACT = Path(__file__).parents[3] / "tests" / "contract"
NOW = "2026-10-20T10:00:00Z"
DECISION_ID = "mdc_01JABCDEFGHJKMNPQRSTVWXYZ0"

RANDOM = ("sprisk.validation.random_split@1.0.0", {"test_fraction": 0.2, "seed": 1})
TEMPORAL = ("sprisk.validation.temporal_split@1.0.0", {"time_column": "day", "test_fraction": 0.2})
GROUP = (
    "sprisk.validation.group_split@1.0.0",
    {"group_column": "patient", "test_fraction": 0.2, "seed": 1},
)


def question(**facts: dict[str, str]) -> QuestionVersion:
    raw = json.loads((CONTRACT / "question_version/valid/exploration-no-target.json").read_text())
    for key in ("time_column", "entity_column"):
        raw.pop(key, None)
    return QuestionVersion.model_validate_json(json.dumps({**raw, **facts}))


def pipeline(split: tuple[str, dict[str, Any]], decided: bool = False) -> PipelineVersion:
    node: dict[str, Any] = {"id": "split", "operator": split[0], "params": split[1]}
    if decided:
        node["methodology_decision_id"] = DECISION_ID
    return PipelineVersion.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.pipeline_version/v1",
                "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1",
                "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "nodes": [node],
                "edges": [],
                "created_at": NOW,
            }
        )
    )


def new_ids() -> Callable[[], str]:
    ids = (f"mck_01JABCDEFGHJKMNPQRSTVWXY{i:02d}" for i in range(100))
    return lambda: next(ids)


def decision() -> MethodologyDecision:
    raw = json.loads((CONTRACT / "methodology_decision/valid/applied.json").read_text())
    return MethodologyDecision.model_validate_json(json.dumps({**raw, "rule": CHECK}))


def check(
    split: tuple[str, dict[str, Any]],
    asked: QuestionVersion | None,
    decisions: tuple[MethodologyDecision, ...] = (),
    decided: bool = False,
) -> MethodologyCheck:
    (result,) = split_design(pipeline(split, decided), asked, list(decisions), new_ids(), NOW)
    return result


CONFIRMED_TIME = {"time_column": {"value": "day", "origin": "confirmed"}}
CONFIRMED_ENTITY = {"entity_column": {"value": "patient", "origin": "confirmed"}}


def test_shares_the_split_rule_s_identity() -> None:
    assert CHECK == "methodology.supervised.data_split@1.0.0"


@pytest.mark.parametrize(
    ("split", "facts", "verdict"),
    [
        (TEMPORAL, CONFIRMED_TIME, "pass"),
        (RANDOM, CONFIRMED_TIME, "fail"),
        (GROUP, CONFIRMED_TIME, "fail"),
        ((TEMPORAL[0], {**TEMPORAL[1], "time_column": "other"}), CONFIRMED_TIME, "fail"),
        (GROUP, CONFIRMED_ENTITY, "pass"),
        (RANDOM, CONFIRMED_ENTITY, "fail"),
        ((GROUP[0], {**GROUP[1], "group_column": "other"}), CONFIRMED_ENTITY, "fail"),
        (RANDOM, {}, "pass"),
    ],
)
def test_the_split_must_follow_the_confirmed_time_or_entity_fact(
    split: tuple[str, dict[str, Any]], facts: dict[str, Any], verdict: str
) -> None:
    result = check(split, question(**facts))
    assert result.verdict == verdict
    assert result.cited_nodes[0].root == "split"
    assert result.phase is not None and result.phase.value == "plan"


def test_an_inferred_fact_does_not_require_a_split() -> None:
    inferred = {"time_column": {"value": "day", "origin": "inferred"}}
    assert check(RANDOM, question(**inferred)).verdict == "pass"


def test_a_failure_says_which_fact_and_what_to_use_instead() -> None:
    result = check(RANDOM, question(**CONFIRMED_TIME))
    assert "day" in result.rationale
    assert "time" in result.rationale.lower()


def test_a_design_pass_is_partial_coverage_because_rows_are_not_inspected() -> None:
    result = check(TEMPORAL, question(**CONFIRMED_TIME))
    assert result.coverage is not None and result.coverage.value == "partial"
    assert result.limitations


def test_without_a_question_the_split_is_not_assessed() -> None:
    result = check(RANDOM, None)
    assert result.verdict == "not_assessed"


def test_a_pipeline_without_a_split_is_not_assessed() -> None:
    no_split = pipeline(RANDOM).model_copy(update={"nodes": []})
    (result,) = split_design(no_split, question(**CONFIRMED_TIME), [], new_ids(), NOW)
    assert result.verdict == "not_assessed"
    assert result.cited_nodes == []


def test_the_check_names_the_decision_that_chose_the_split() -> None:
    result = check(TEMPORAL, question(**CONFIRMED_TIME), (decision(),), decided=True)
    assert result.methodology_decision_id is not None
    assert result.methodology_decision_id.root == DECISION_ID


def test_a_hand_set_split_names_no_decision() -> None:
    result = check(TEMPORAL, question(**CONFIRMED_TIME))
    assert result.methodology_decision_id is None


def test_each_split_gets_its_own_check() -> None:
    raw = json.loads(pipeline(RANDOM).model_dump_json(by_alias=True))
    raw["nodes"].append({**raw["nodes"][0], "id": "split2"})
    two = PipelineVersion.model_validate_json(json.dumps(raw))
    results = split_design(two, question(), [], new_ids(), NOW)
    assert [r.cited_nodes[0].root for r in results] == ["split", "split2"]
    assert len({r.id.root for r in results}) == 2
