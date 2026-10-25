"""The split design check: does the pipeline split the way the question's facts require?"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml
from method_harness import decide as decide_method
from repo_operators import repo_operators

from sprisk_contracts import (
    MethodologyCheck,
    MethodologyDecision,
    PipelineVersion,
    QuestionVersion,
)
from sprisk_supervised.split_design import CHECK, split_design
from sprisk_supervised.split_leakage import CheckInputError

CONTRACT = Path(__file__).parents[3] / "tests" / "contract"
OPERATORS = repo_operators()
# A split added as a folder only, under another name, that folds by time (ADR-0064).
LATER = "acme.validation.later_split@1.0.0"
_temporal = OPERATORS["sprisk.validation.temporal_split@1.0.0"]
OPERATORS[LATER] = _temporal.model_copy(
    update={"id": _temporal.id.model_copy(update={"root": LATER})}
)
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
    (result,) = split_design(
        pipeline(split, decided), OPERATORS, asked, list(decisions), new_ids(), NOW
    )
    return result


CONFIRMED_TIME = {"time_column": {"value": "day", "origin": "confirmed"}}
CONFIRMED_ENTITY = {"entity_column": {"value": "patient", "origin": "confirmed"}}


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


def test_a_split_is_judged_by_the_folds_it_declares_not_its_name() -> None:
    later = (LATER, TEMPORAL[1])
    assert check(later, question(**CONFIRMED_TIME)).verdict == "pass"
    assert check(later, question(**CONFIRMED_ENTITY)).verdict == "fail"


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
    (result,) = split_design(no_split, OPERATORS, question(**CONFIRMED_TIME), [], new_ids(), NOW)
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


def test_a_renamed_split_that_folds_as_its_decision_chose_has_not_drifted() -> None:
    chose_temporal = decision(alternative_id="temporal")
    later = (LATER, TEMPORAL[1])
    result = check(later, question(**CONFIRMED_TIME), (chose_temporal,), decided=True)
    assert result.verdict == "pass", result.rationale


def test_a_step_with_an_unknown_operator_is_bad_input() -> None:
    with pytest.raises(CheckInputError, match="unknown operator acme.unknown.split@1.0.0"):
        check(("acme.unknown.split@1.0.0", {}), question(**CONFIRMED_TIME))


def test_a_split_a_method_decided_is_judged_on_the_question_alone() -> None:
    raw = json.loads(
        (CONTRACT / "methodology_decision/valid/by-method-changes-steps.json").read_text()
    )
    by_method = MethodologyDecision.model_validate_json(json.dumps({**raw, "id": DECISION_ID}))
    result = check(TEMPORAL, question(**CONFIRMED_TIME), (by_method,), decided=True)
    assert result.verdict == "pass"
    assert result.methodology_decision_id is None


# The concept each confirmed question fact binds (ADR-0063 amendment).
FACT_CONCEPTS = {"time_column": "common.event_time", "entity_column": "common.item_identity"}
METHOD = Path(__file__).parents[1] / "methods" / "split_method" / "method.yaml"


@pytest.mark.parametrize("time", [None, "confirmed"])
@pytest.mark.parametrize("entity", [None, "confirmed"])
@pytest.mark.parametrize("repeated", ["independent_rows", "group_by_title"])
def test_the_gate_never_fails_the_split_the_method_chooses(
    time: str | None, entity: str | None, repeated: str
) -> None:
    facts: dict[str, Any] = {}
    columns = {"common.target": "churned"}
    if time:
        facts["time_column"] = {"value": "day", "origin": time}
        columns[FACT_CONCEPTS["time_column"]] = "day"
    if entity:
        facts["entity_column"] = {"value": "patient", "origin": entity}
        columns[FACT_CONCEPTS["entity_column"]] = "patient"
    elif repeated == "group_by_title":
        # The repeated-items method binds the item to the column the producer adds.
        columns["common.item_identity"] = "item_group"
    chosen = decide_method(
        "supervised/split_method", decisions={"data.repeated_items": repeated}, bound=list(columns)
    )
    option = next(o for o in method_options() if o["id"] == chosen["option"])
    replace = option["action"]["replace"]
    params = dict(replace.get("settings", {}))
    params.update({p: columns[c] for p, c in replace.get("concepts", {}).items() if c in columns})
    result = check((replace["operator"], params), question(**facts))
    assert result.verdict != "fail", f"{option['id']}: {result.rationale}"


def method_options() -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = yaml.safe_load(METHOD.read_text())["options"]
    return options


def test_a_hand_set_split_names_no_decision() -> None:
    result = check(TEMPORAL, question(**CONFIRMED_TIME))
    assert result.methodology_decision_id is None


def test_each_split_gets_its_own_check() -> None:
    raw = json.loads(pipeline(RANDOM).model_dump_json(by_alias=True))
    raw["nodes"].append({**raw["nodes"][0], "id": "split2"})
    two = PipelineVersion.model_validate_json(json.dumps(raw))
    results = split_design(two, OPERATORS, question(), [], new_ids(), NOW)
    assert [r.cited_nodes[0].root for r in results] == ["split", "split2"]
    assert len({r.id.root for r in results}) == 2


def bound(concept: str, column: str) -> dict[str, Any]:
    return {
        "schema_version": "sprisk.binding/v1",
        "concept": concept,
        "source": {"column": column},
        "set_by": {"assurance": "stated"},
    }


@pytest.mark.parametrize(("split", "verdict"), [(GROUP, "pass"), (RANDOM, "fail")])
def test_a_bound_item_counts_like_a_confirmed_entity_fact(
    split: tuple[str, dict[str, Any]], verdict: str
) -> None:
    asked = question(bindings=[bound("common.item_identity", "patient")])
    assert check(split, asked).verdict == verdict


def test_a_binding_takes_the_place_of_the_fact_for_its_concept() -> None:
    other = {"entity_column": {"value": "ward", "origin": "confirmed"}}
    asked = question(**other, bindings=[bound("common.item_identity", "patient")])
    assert check(GROUP, asked).verdict == "pass"


def test_a_split_a_method_made_without_a_fact_points_to_the_methods_promises() -> None:
    raw = json.loads(
        (CONTRACT / "methodology_decision/valid/by-method-changes-steps.json").read_text()
    )
    by_method = MethodologyDecision.model_validate_json(json.dumps({**raw, "id": DECISION_ID}))
    by_item = (GROUP[0], {**GROUP[1], "group_column": "item_group"})
    result = check(by_item, question(), (by_method,), decided=True)
    assert result.verdict == "not_assessed"
    assert "item_groups" in result.rationale and "no_group_overlap" in result.rationale
    assert "freely" not in result.rationale


@pytest.mark.parametrize(("split", "verdict"), [(GROUP, "pass"), (RANDOM, "fail")])
def test_a_split_a_method_made_is_still_judged_when_the_question_binds_the_item(
    split: tuple[str, dict[str, Any]], verdict: str
) -> None:
    raw = json.loads(
        (CONTRACT / "methodology_decision/valid/by-method-changes-steps.json").read_text()
    )
    by_method = MethodologyDecision.model_validate_json(json.dumps({**raw, "id": DECISION_ID}))
    asked = question(bindings=[bound("common.item_identity", "patient")])
    assert check(split, asked, (by_method,), decided=True).verdict == verdict


def test_a_binding_no_person_stated_or_confirmed_does_not_replace_a_fact() -> None:
    unasked = {
        **bound("common.item_identity", "patient"),
        "set_by": {"assurance": "rule", "method": "methodology.common.repeated_items@1.0.0"},
    }
    asked = question(entity_column={"value": "ward", "origin": "confirmed"}, bindings=[unasked])
    assert check(GROUP, asked).verdict == "fail"
