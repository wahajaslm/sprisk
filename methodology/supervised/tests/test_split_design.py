"""The split design check: does the pipeline split the way the question's facts require?"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml

from sprisk_contracts import (
    MethodologyCheck,
    MethodologyDecision,
    PipelineVersion,
    QuestionVersion,
    RuleDecision,
    RuleObservation,
)
from sprisk_supervised.split_design import ALTERNATIVE_OPERATORS, CHECK, split_design
from sprisk_supervised.split_leakage import CheckInputError
from sprisk_workers.rule import load_decide

CONTRACT = Path(__file__).parents[3] / "tests" / "contract"
RULE_DIR = Path(__file__).parents[1] / "rules" / "data_split"
NOW = "2026-10-20T10:00:00Z"
DECISION_ID = "mdc_01JABCDEFGHJKMNPQRSTVWXYZ0"

RANDOM = ("sprisk.validation.random_split@1.0.0", {"test_fraction": 0.2, "seed": 1})
TEMPORAL = ("sprisk.validation.temporal_split@1.0.0", {"time_column": "day", "test_fraction": 0.2})
PURGED = (TEMPORAL[0], {**TEMPORAL[1], "group_column": "patient"})
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


def decision(**fields: str) -> MethodologyDecision:
    """The applied fixture as a temporal split decision of this rule, with `fields` replaced."""
    raw = json.loads((CONTRACT / "methodology_decision/valid/applied.json").read_text())
    chosen = {**raw, "rule": CHECK, "alternative_id": "temporal", "subject_node_id": "split"}
    return MethodologyDecision.model_validate_json(json.dumps({**chosen, **fields}))


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


def rule_manifest() -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load((RULE_DIR / "rule.yaml").read_text())
    return loaded


def test_shares_the_split_rule_s_identity() -> None:
    manifest = rule_manifest()
    assert manifest["id"] == CHECK
    assert manifest["verification"]["check_id"] == CHECK


def test_knows_the_operator_of_every_alternative_the_rule_offers() -> None:
    actions = {a["id"]: a["action"]["operator"] for a in rule_manifest()["alternatives"]}
    assert {k: f"{v}@1.0.0" for k, v in ALTERNATIVE_OPERATORS.items()} == actions


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
        (GROUP, {**CONFIRMED_TIME, **CONFIRMED_ENTITY}, "fail"),
        (TEMPORAL, {**CONFIRMED_TIME, **CONFIRMED_ENTITY}, "fail"),
        (PURGED, {**CONFIRMED_TIME, **CONFIRMED_ENTITY}, "pass"),
    ],
)
def test_the_split_must_follow_the_confirmed_time_or_entity_fact(
    split: tuple[str, dict[str, Any]], facts: dict[str, Any], verdict: str
) -> None:
    result = check(split, question(**facts))
    assert result.verdict == verdict
    assert result.cited_nodes[0].root == "split"
    assert result.phase is not None and result.phase.value == "plan"


@pytest.mark.parametrize("fact", ["time_column", "entity_column"])
def test_an_inferred_fact_leaves_the_split_unassessed_until_it_is_confirmed(fact: str) -> None:
    result = check(RANDOM, question(**{fact: {"value": "day", "origin": "inferred"}}))
    assert result.verdict == "not_assessed"
    assert "confirm" in result.rationale.lower()
    assert "day" in result.rationale


def test_a_temporal_split_that_does_not_purge_a_confirmed_entity_fails_and_says_so() -> None:
    result = check(TEMPORAL, question(**CONFIRMED_TIME, **CONFIRMED_ENTITY))
    assert result.verdict == "fail"
    assert "group_column" in result.rationale and "patient" in result.rationale


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


@pytest.mark.parametrize(
    "sent",
    [
        (),
        (decision(rule="methodology.supervised.missingness@1.0.0"),),
        (decision(subject_node_id="other"),),
    ],
    ids=["not sent", "another rule", "another node"],
)
def test_a_split_citing_a_decision_that_is_not_its_own_is_bad_input(
    sent: tuple[MethodologyDecision, ...],
) -> None:
    with pytest.raises(CheckInputError) as e:
        check(TEMPORAL, question(**CONFIRMED_TIME), sent, decided=True)
    assert DECISION_ID in str(e.value)


def test_a_split_changed_after_its_decision_fails_and_says_so() -> None:
    chose_random = decision(alternative_id="simple_random")
    result = check(TEMPORAL, question(**CONFIRMED_TIME), (chose_random,), decided=True)
    assert result.verdict == "fail"
    assert "simple_random" in result.rationale
    assert result.methodology_decision_id is not None


FACT_STATES = [None, "inferred", "confirmed"]


@pytest.mark.parametrize("time", FACT_STATES)
@pytest.mark.parametrize("entity", FACT_STATES)
def test_every_option_decide_offers_is_never_failed_by_the_gate(
    time: str | None, entity: str | None
) -> None:
    facts: dict[str, Any] = {}
    observed = {
        "question.target": ("churned", "confirmed"),
        "question.task": ("classification", "confirmed"),
    }
    if time:
        facts["time_column"] = {"value": "day", "origin": time}
        observed["question.time_column"] = ("day", time)
    if entity:
        facts["entity_column"] = {"value": "patient", "origin": entity}
        observed["question.entity_column"] = ("patient", entity)
    offered = decide_split(observed)
    applicable = [a for a in offered.alternatives if a.applicability.value == "applicable"]
    assert applicable, "the rule always offers a choice"
    for option in applicable:
        operator = f"{ALTERNATIVE_OPERATORS[option.id]}@1.0.0"
        params = (option.params.model_extra or {}) if option.params else {}
        result = check((operator, params), question(**facts))
        assert result.verdict != "fail", f"{option.id}: {result.rationale}"


def decide_split(facts: dict[str, tuple[str, str]]) -> RuleDecision:
    observation = RuleObservation.model_validate_json(
        json.dumps(
            {
                "schema_version": "sprisk.rule_observation/v1",
                "rule": CHECK,
                "facts": {k: {"value": v, "origin": o} for k, (v, o) in facts.items()},
                "profile": {},
                "settings": {"default_test_fraction": 0.2, "default_seed": 42},
            }
        )
    )
    return load_decide(RULE_DIR / "rule.py")(observation)


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
