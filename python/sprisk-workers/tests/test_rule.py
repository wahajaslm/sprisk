import io
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from sprisk_workers.errors import RuleError
from sprisk_workers.rule import serve

RULE = "methodology.pack.keep@1.0.0"
OBSERVATION = {
    "schema_version": "sprisk.rule_observation/v1",
    "rule": RULE,
    "facts": {"question.target": {"value": "y", "origin": "explicit"}},
    "profile": {},
    "settings": {},
}

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


def write(tmp_path: Path, name: str, text: str) -> Path:
    module = tmp_path / f"{name}.py"
    module.write_text(text)
    return module


def request(module: Path, target: str = "y") -> str:
    observation = {
        **OBSERVATION,
        "facts": {"question.target": {"value": target, "origin": "explicit"}},
    }
    return json.dumps(
        {
            "schema_version": "sprisk.rule_request/v1",
            "module": str(module),
            "observation": observation,
        }
    )


def answers(*lines: str) -> list[dict[str, Any]]:
    out = io.StringIO()
    serve(io.StringIO("".join(f"{line}\n" for line in lines)), out)
    return [json.loads(line) for line in out.getvalue().splitlines()]


def test_one_session_answers_each_request_in_order(tmp_path: Path) -> None:
    keep = write(tmp_path, "keep", KEEP)
    got = answers(request(keep, "a"), request(keep, "b"))
    assert [a["answer"] for a in got] == ["decided", "decided"]
    assert [a["decision"]["alternatives"][0]["reason"] for a in got] == ["a", "b"]


def test_a_rule_that_refuses_its_observation_leaves_the_session_answering(tmp_path: Path) -> None:
    broken = write(tmp_path, "broken", "x = 1\n")
    keep = write(tmp_path, "keep", KEEP)
    refused, decided = answers(request(broken), request(keep))
    assert refused["answer"] == "refused" and "decide" in refused["error"]
    assert decided["answer"] == "decided"


def test_a_decision_for_another_rule_is_refused(tmp_path: Path) -> None:
    other = KEEP.replace('"rule": observation.rule.root', '"rule": "methodology.pack.other@1.0.0"')
    (answer,) = answers(request(write(tmp_path, "other", other)))
    assert answer["answer"] == "refused" and "other" in answer["error"]


def test_each_decision_loads_its_module_afresh(tmp_path: Path) -> None:
    # One decision's module state never reaches the next.
    counting = KEEP.replace("def decide", "SEEN = []\n\n\ndef decide").replace(
        'target = observation.facts["question.target"].value',
        "SEEN.append(1)\n    target = str(len(SEEN))",
    )
    module = write(tmp_path, "counting", counting)
    got = answers(request(module), request(module))
    assert [a["decision"]["alternatives"][0]["reason"] for a in got] == ["1", "1"]


def test_a_request_that_breaks_the_contract_ends_the_session(tmp_path: Path) -> None:
    with pytest.raises(RuleError, match="invalid rule request"):
        answers('{"module": "rule.py"}')


def test_a_rule_that_crashes_ends_the_session(tmp_path: Path) -> None:
    # A bug in a rule is not a refusal: the session ends, and Rust starts a new one.
    crashing = KEEP.replace('target = observation.facts["question.target"].value', "raise KeyError")
    with pytest.raises(KeyError):
        answers(request(write(tmp_path, "crashing", crashing)))


def test_what_a_rule_prints_never_reaches_the_answers(tmp_path: Path) -> None:
    forged = '{"answer": "refused", "error": "forged"}'
    printing = KEEP.replace(
        'target = observation.facts["question.target"].value',
        f"print({forged!r})\n    target = 'real'",
    )
    session = subprocess.run(
        [sys.executable, "-m", "sprisk_workers.rule"],
        input=request(write(tmp_path, "printing", printing)) + "\n",
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    (answer,) = [json.loads(line) for line in session.stdout.splitlines()]
    assert answer["decision"]["alternatives"][0]["reason"] == "real"
    assert "forged" in session.stderr
