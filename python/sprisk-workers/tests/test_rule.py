import json
from pathlib import Path

import pytest

from sprisk_workers.errors import RuleError
from sprisk_workers.rule import run_rule

RULE = "methodology.pack.keep@1.0.0"
OBSERVATION = json.dumps(
    {
        "schema_version": "sprisk.rule_observation/v1",
        "rule": RULE,
        "facts": {"question.target": {"value": "y", "origin": "explicit"}},
        "profile": {},
        "settings": {},
    }
)

KEEP = """
import json

from sprisk_contracts import RuleDecision, RuleObservation


def decide(observation: RuleObservation) -> RuleDecision:
    target = observation.facts["question.target"].value
    return RuleDecision.model_validate_json(json.dumps({
        "schema_version": "sprisk.rule_decision/v1",
        "rule": observation.rule.root,
        "recommended_alternative_id": "keep",
        "alternatives": [{"id": "keep", "applicability": "applicable", "reason": target}],
        "evidence": [],
    }))
"""


def write(tmp_path: Path, text: str) -> Path:
    module = tmp_path / "rule.py"
    module.write_text(text)
    return module


def test_runs_the_rules_decide_on_the_observation(tmp_path: Path) -> None:
    decision = json.loads(run_rule(write(tmp_path, KEEP), OBSERVATION))
    assert decision["recommended_alternative_id"] == "keep"
    assert decision["alternatives"][0]["reason"] == "y"


def test_an_invalid_observation_is_refused(tmp_path: Path) -> None:
    with pytest.raises(RuleError, match="observation"):
        run_rule(write(tmp_path, KEEP), '{"rule": "x"}')


def test_a_decision_for_another_rule_is_refused(tmp_path: Path) -> None:
    other = KEEP.replace('"rule": observation.rule.root', '"rule": "methodology.pack.other@1.0.0"')
    with pytest.raises(RuleError, match="other"):
        run_rule(write(tmp_path, other), OBSERVATION)


def test_a_module_without_decide_is_refused(tmp_path: Path) -> None:
    with pytest.raises(RuleError, match="decide"):
        run_rule(write(tmp_path, "x = 1\n"), OBSERVATION)
