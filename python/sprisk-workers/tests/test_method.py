import io
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from sprisk_workers.authoring import method, option
from sprisk_workers.errors import ManifestError, MethodError
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


def test_a_method_reads_the_statements_it_declares_and_none_for_an_unstated_one(
    tmp_path: Path,
) -> None:
    body = (
        "return ctx.choose('grouped', "
        "f\"{ctx.statement('costs')['false_negative']} {ctx.statement('success_bar')}\")"
    )
    needs = {
        "concepts": [],
        "evidence": [],
        "decisions": [],
        "statements": ["costs", "success_bar"],
    }
    costs = {"positive": "churned", "false_negative": 5.0, "false_positive": 1.0}
    answer = decide_with(tmp_path, body, needs=needs, statements={"costs": costs})
    assert answer["reason"] == "5.0 None"


@pytest.mark.parametrize(
    ("body", "names"),
    [
        ("return ctx.evidence('data.other')", "data.other"),
        ("return ctx.decision('data.other')", "data.other"),
        ("return ctx.bound('pack.other')", "pack.other"),
        ("return ctx.statement('costs')", "costs"),
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


DECORATED = """
from authored_method import split_way
"""
WAY = "methodology.test.split_way@1.0.0"


def decorated_request(module: Path, **changes: Any) -> str:
    message = {
        "schema_version": "sprisk.method_request/v1",
        "module": str(module),
        "method": WAY,
        "needs": {"concepts": ["common.event_time"], "evidence": [], "decisions": []},
        "options": ["by_time", "first_rows"],
        "task": "classification",
        "evidence": {},
        "decisions": {},
        "bound": ["common.event_time"],
    }
    return json.dumps({**message, **changes})


def test_a_decorated_method_answers_from_the_project_s_bindings(tmp_path: Path) -> None:
    module = write(tmp_path, "method", DECORATED)

    bound, unbound = answers(decorated_request(module), decorated_request(module, bound=[]))

    assert bound == {
        "answer": "decided",
        "method": WAY,
        "outcome": "choose",
        "option": "by_time",
        "reason": "A time column orders the rows.",
    }
    assert (unbound["option"], unbound["reason"]) == ("first_rows", "No time column.")


def test_a_ruled_out_choice_asks_the_person_to_pick_an_open_option(tmp_path: Path) -> None:
    module = write(tmp_path, "method", DECORATED)
    ruled_out = [
        {"option": "by_time", "verification": "no_shared_rows", "detail": "4 rows are on both."}
    ]

    (asked,) = answers(decorated_request(module, options=["first_rows"], ruled_out=ruled_out))
    # head_split needs no column, so nothing more is asked.

    assert (asked["outcome"], asked["option"]) == ("ask", "first_rows")
    assert asked["reason"] == (
        "Train on earlier rows, test on later ones broke its promise: 4 rows are on both. "
        "The first rows train would keep it instead."
    )


def test_a_ruled_out_choice_with_no_fallback_leaves_no_fair_option(tmp_path: Path) -> None:
    module = write(tmp_path, "method", DECORATED)
    ruled_out = [{"option": "first_rows", "verification": "no_shared_rows", "detail": "Broken."}]

    (refused,) = answers(
        decorated_request(module, bound=[], options=["by_time"], ruled_out=ruled_out)
    )

    assert refused["answer"] == "refused"
    assert (
        "The first rows train broke its promise: Broken. No other option is fair"
        in (refused["error"])
    )


def test_a_decorated_method_with_no_open_option_refuses(tmp_path: Path) -> None:
    module = write(tmp_path, "method", DECORATED)
    ruled_out = [{"option": "by_time", "verification": "no_shared_rows", "detail": "Broken."}]

    (refused,) = answers(decorated_request(module, options=[], ruled_out=ruled_out))

    assert refused["answer"] == "refused"
    assert "no option is left" in refused["error"]


def test_a_fallback_must_be_one_of_the_method_s_options() -> None:
    from authored_method import head_split

    with pytest.raises(ManifestError, match=r"option only falls back to \['nowhere'\]"):
        method(
            id="odd", decides="x.odd", activity="Test", applies_when={}, source="t",
            options={"only": option("Only", head_split, when="a", condition="b",
                                    fallbacks=["nowhere"])},
        )  # fmt: skip


def test_a_decorated_promise_s_verdict_is_its_verification(tmp_path: Path) -> None:
    module = write(tmp_path, "method", DECORATED)
    evidence = {"shared": 2, "examples": [], "status": "fail", "detail": "2 rows are on both."}

    (found,) = answers(
        verify_request(module, method=WAY, verification="no_shared_rows", evidence=evidence)
    )

    assert (found["result"], found["detail"]) == ("fail", "2 rows are on both.")


def test_a_fallback_that_needs_an_unbound_column_asks_for_it(tmp_path: Path) -> None:
    module = write(
        tmp_path,
        "method",
        """
from authored_method import head_split, time_split
from sprisk_workers.authoring import method, option


@method(
    id="split_way", decides="split.way", activity="Test", applies_when={}, source="t",
    columns={"event_time": "common.event_time"},
    options={
        "first_rows": option("The first rows train", head_split, when="a", condition="b",
                             fallbacks=["by_time"]),
        "by_time": option("By time", time_split, when="c", condition="d"),
    },
)
def split_way(task, event_time):
    \"\"\"Split way

    Which?

    None.
    \"\"\"
    return method.choose("first_rows", reason="Always first rows.")
""",
    )
    ruled_out = [{"option": "first_rows", "verification": "no_shared_rows", "detail": "Broken."}]

    (asked,) = answers(
        decorated_request(module, bound=[], options=["by_time"], ruled_out=ruled_out)
    )

    assert (asked["outcome"], asked["option"]) == ("ask", "by_time")
    assert asked["reason"].endswith(
        "By time would keep it instead. It needs the event time column named."
    )
