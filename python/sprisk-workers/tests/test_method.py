import io
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from sprisk_workers.errors import MethodError
from sprisk_workers.method import serve

METHOD = "methodology.pack.items@1.0.0"

ASKS = """
def decide(ctx):
    found = ctx.evidence("data.groups")
    if found is None:
        return ctx.choose("independent", "Nothing names the item.")
    if found["groups"] == 0:
        return ctx.choose("independent", "No two rows share a title.")
    return ctx.ask("grouped", f"{found['groups']} groups. Same item?")
"""


def write(tmp_path: Path, name: str, text: str) -> Path:
    module = tmp_path / f"{name}.py"
    module.write_text(text)
    return module


def request(module: Path, **changes: Any) -> str:
    message = {
        "schema_version": "sprisk.method_request/v1",
        "module": str(module),
        "method": METHOD,
        "needs": {
            "concepts": ["pack.title"],
            "evidence": ["data.groups"],
            "decisions": ["data.earlier"],
        },
        "options": ["grouped", "independent"],
        "task": "classification",
        "evidence": {"data.groups": {"groups": 3}},
        "decisions": {"data.earlier": "kept"},
        "bound": ["pack.title"],
    }
    return json.dumps({**message, **changes})


def answers(*lines: str) -> list[dict[str, Any]]:
    out = io.StringIO()
    serve(io.StringIO("".join(f"{line}\n" for line in lines)), out)
    return [json.loads(line) for line in out.getvalue().splitlines()]


def decide_with(tmp_path: Path, body: str, **changes: Any) -> dict[str, Any]:
    module = write(tmp_path, "method", f"def decide(ctx):\n    {body}\n")
    (answer,) = answers(request(module, **changes))
    return answer


def test_a_method_asks_a_person_to_confirm_an_option(tmp_path: Path) -> None:
    (answer,) = answers(request(write(tmp_path, "asks", ASKS)))
    assert answer == {
        "answer": "decided",
        "method": METHOD,
        "outcome": "ask",
        "option": "grouped",
        "reason": "3 groups. Same item?",
    }


def test_a_method_chooses_on_the_evidence_it_was_given(tmp_path: Path) -> None:
    module = write(tmp_path, "asks", ASKS)
    (answer,) = answers(request(module, evidence={"data.groups": {"groups": 0}}))
    assert (answer["outcome"], answer["option"]) == ("choose", "independent")


def test_needed_evidence_that_could_not_be_measured_reads_as_none(tmp_path: Path) -> None:
    module = write(tmp_path, "asks", ASKS)
    (answer,) = answers(request(module, evidence={}))
    assert answer["reason"] == "Nothing names the item."


def test_a_method_reads_its_decisions_bindings_and_the_task(tmp_path: Path) -> None:
    body = (
        "return ctx.choose('grouped', "
        "f\"{ctx.decision('data.earlier')} {ctx.bound('pack.title')} {ctx.task}\")"
    )
    answer = decide_with(tmp_path, body)
    assert answer["reason"] == "kept True classification"
    answer = decide_with(tmp_path, body, bound=[])
    assert answer["reason"] == "kept False classification"


@pytest.mark.parametrize(
    ("body", "names"),
    [
        ("return ctx.evidence('data.other')", "data.other"),
        ("return ctx.decision('data.other')", "data.other"),
        ("return ctx.bound('pack.other')", "pack.other"),
    ],
)
def test_a_read_the_method_did_not_declare_is_refused(
    tmp_path: Path, body: str, names: str
) -> None:
    answer = decide_with(tmp_path, body)
    assert answer["answer"] == "refused"
    assert names in answer["error"] and "declar" in answer["error"]


def test_an_option_the_method_does_not_have_is_refused(tmp_path: Path) -> None:
    answer = decide_with(tmp_path, "return ctx.ask('shuffled', 'Shuffle?')")
    assert answer["answer"] == "refused" and "shuffled" in answer["error"]


RULED_OUT = [{"option": "grouped", "verification": "kept_apart", "detail": "3 items in both."}]


def test_a_ruled_out_option_says_why_and_cannot_be_taken(tmp_path: Path) -> None:
    body = (
        "return ctx.choose('independent', "
        "f\"{ctx.ruled_out('grouped')} {ctx.ruled_out('independent')}\")"
    )
    answer = decide_with(tmp_path, body, options=["independent"], ruled_out=RULED_OUT)
    assert answer["reason"] == "3 items in both. None"
    answer = decide_with(
        tmp_path,
        "return ctx.ask('grouped', 'Same item?')",
        options=["independent"],
        ruled_out=RULED_OUT,
    )
    assert answer["answer"] == "refused"
    assert "grouped is ruled out: 3 items in both." in answer["error"]
    answer = decide_with(tmp_path, "return ctx.ruled_out('shuffled')", ruled_out=RULED_OUT)
    assert answer["answer"] == "refused" and "shuffled" in answer["error"]


def test_decide_must_return_a_choice_or_an_ask(tmp_path: Path) -> None:
    answer = decide_with(tmp_path, "return 'grouped'")
    assert answer["answer"] == "refused" and "choose or ask" in answer["error"]


def test_a_module_without_decide_is_refused_and_the_session_goes_on(tmp_path: Path) -> None:
    broken = write(tmp_path, "broken", "x = 1\n")
    refused, decided = answers(request(broken), request(write(tmp_path, "asks", ASKS)))
    assert refused["answer"] == "refused" and "decide" in refused["error"]
    assert decided["answer"] == "decided"


def test_a_request_that_breaks_the_contract_ends_the_session() -> None:
    with pytest.raises(MethodError, match="invalid method request"):
        answers('{"module": "method.py"}')


def test_a_method_that_crashes_ends_the_session(tmp_path: Path) -> None:
    module = write(tmp_path, "crashing", "def decide(ctx):\n    raise KeyError\n")
    with pytest.raises(KeyError):
        answers(request(module))


def test_what_a_method_prints_never_reaches_the_answers(tmp_path: Path) -> None:
    forged = '{"answer": "refused", "error": "forged"}'
    printing = ASKS.replace("def decide(ctx):", f"def decide(ctx):\n    print({forged!r})")
    session = subprocess.run(
        [sys.executable, "-m", "sprisk_workers.method"],
        input=request(write(tmp_path, "printing", printing)) + "\n",
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    (answer,) = [json.loads(line) for line in session.stdout.splitlines()]
    assert answer["outcome"] == "ask"
    assert "forged" in session.stderr


VERIFIES = """
def verify_kept_apart(evidence, settings):
    if evidence["overlapping"] > settings["allowed"]:
        return "fail", f"{evidence['overlapping']} items are on both sides."
    return "pass", "No item is on both sides."
"""


def verify_request(module: Path, **changes: Any) -> str:
    message = {
        "schema_version": "sprisk.verification_request/v1",
        "module": str(module),
        "method": METHOD,
        "verification": "kept_apart",
        "evidence": {"overlapping": 0},
        "settings": {"allowed": 0},
    }
    return json.dumps({**message, **changes})


def test_a_promise_is_checked_on_the_evidence_and_settings_it_was_given(tmp_path: Path) -> None:
    module = write(tmp_path, "verifies", VERIFIES)
    held, broken = answers(
        verify_request(module), verify_request(module, evidence={"overlapping": 2})
    )
    assert held == {
        "answer": "verified",
        "method": METHOD,
        "verification": "kept_apart",
        "result": "pass",
        "detail": "No item is on both sides.",
    }
    assert (broken["result"], broken["detail"]) == ("fail", "2 items are on both sides.")


def test_a_verification_with_no_function_is_refused(tmp_path: Path) -> None:
    module = write(tmp_path, "verifies", VERIFIES)
    (answer,) = answers(verify_request(module, verification="other_promise"))
    assert answer["answer"] == "refused"
    assert "verify_other_promise" in answer["error"]


@pytest.mark.parametrize(
    "returned", ['"stale", "seen before"', '"pass", ""', '"pass"', '"maybe", "no idea"']
)
def test_a_verification_that_returns_no_result_and_detail_is_refused(
    tmp_path: Path, returned: str
) -> None:
    module = write(
        tmp_path, "verifies", f"def verify_kept_apart(evidence, settings):\n    return {returned}\n"
    )
    (answer,) = answers(verify_request(module))
    assert answer["answer"] == "refused"
