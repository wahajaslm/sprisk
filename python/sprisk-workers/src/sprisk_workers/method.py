"""Run methods' decide(ctx) and verify_<name>() (ADR-0063), one session per walk round.

Run as `python -m sprisk_workers.method`: one MethodRequest or VerificationRequest per line on
stdin, one MethodAnswer per line on stdout, until stdin closes. Rust picks each module from the
loaded catalog and sends only what the method's needs declare; ctx refuses any other read.
"""

import importlib.util
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO, get_args

from pydantic import ValidationError

from sprisk_contracts import MethodAnswer, MethodRequest, VerificationOutcome, VerificationRequest
from sprisk_workers.errors import MethodError


@dataclass(frozen=True)
class Outcome:
    outcome: str
    option: str
    reason: str


@dataclass(frozen=True)
class Shortlist:
    """A compared method's options for the engine to compare on the same folds (ADR-0063 D3)."""

    options: list[str]
    reason: str


class Context:
    """What decide() may see: only what its method.yaml says it needs."""

    def __init__(self, request: MethodRequest) -> None:
        sent = request.model_dump(mode="json")
        self._method = sent["method"]
        self._needs = sent["needs"]
        self._options = sent["options"]
        self._evidence = sent["evidence"]
        self._decisions = sent["decisions"]
        self._bound = set(sent["bound"])
        self._ruled_out = {r["option"]: r["detail"] for r in sent.get("ruled_out") or []}
        self._statements = sent.get("statements") or {}
        self.task: str = sent["task"]

    def evidence(self, kind: str) -> dict[str, Any] | None:
        """What was measured; None when it cannot be measured, as a concept is unbound."""
        self._declared("evidence", kind)
        found: dict[str, Any] | None = self._evidence.get(kind)
        return found

    def decision(self, key: str) -> str:
        self._declared("decisions", key)
        option: str = self._decisions[key]
        return option

    def statement(self, name: str) -> Any:
        """What the question states; None when it does not say. Never guessed."""
        self._declared("statements", name)
        return self._statements.get(name)

    def bound(self, concept: str) -> bool:
        """Whether a binding names the concept. Never which column: decide() reads no names."""
        self._declared("concepts", concept)
        return concept in self._bound

    def ruled_out(self, option: str) -> str | None:
        """What the failed check found when this walk took `option` and it broke its promise;
        None when it is still open. A ruled-out option cannot be chosen or asked."""
        if option not in self._options and option not in self._ruled_out:
            raise MethodError(f"{self._method} has no option {option}")
        detail: str | None = self._ruled_out.get(option)
        return detail

    def choose(self, option: str, reason: str) -> Outcome:
        return Outcome("choose", self._option(option), reason)

    def ask(self, option: str, question: str) -> Outcome:
        return Outcome("ask", self._option(option), question)

    def compare(self, options: list[str], reason: str) -> Shortlist:
        if len(set(options)) < 2 or len(set(options)) != len(options):
            raise MethodError(f"{self._method}: a comparison needs at least two options, each once")
        return Shortlist([self._option(o) for o in options], reason)

    def _declared(self, kind: str, name: str) -> None:
        if name not in (self._needs.get(kind) or []):
            raise MethodError(f"{self._method} reads {kind} {name} without declaring it")

    def _option(self, option: str) -> str:
        if option in self._ruled_out:
            raise MethodError(
                f"{self._method}: option {option} is ruled out: {self._ruled_out[option]}"
            )
        if option not in self._options:
            raise MethodError(f"{self._method} has no option {option}")
        return option


Decide = Callable[[Context], Any]

# What a verification may find; stale is the control plane's word, never a method's.
OUTCOMES = {o.value for o in VerificationOutcome}
(VERIFY,) = get_args(VerificationRequest.model_fields["schema_version"].annotation)


def load_function(module_path: Path, name: str) -> Callable[..., Any]:
    spec = importlib.util.spec_from_file_location("sprisk_method", module_path)
    if spec is None or spec.loader is None:
        raise MethodError(f"cannot load method module {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    found = getattr(module, name, None)
    if not callable(found):
        raise MethodError(f"{module_path} has no {name}() function")
    return found  # type: ignore[no-any-return]


def answer(request: MethodRequest) -> MethodAnswer:
    """What decide() returned, or the method's own refusal; any other failure is a bug and
    ends the session."""
    method = request.method.root
    try:
        outcome = load_function(Path(request.module), "decide")(Context(request))
        if not isinstance(outcome, Outcome | Shortlist):
            raise MethodError(f"{method}: decide() must return ctx.choose, ask or compare")
    except MethodError as e:
        return MethodAnswer.model_validate_json(json.dumps({"answer": "refused", "error": str(e)}))
    if isinstance(outcome, Shortlist):
        listed = {
            "answer": "shortlisted",
            "method": method,
            "shortlist": outcome.options,
            "reason": outcome.reason,
        }
        return MethodAnswer.model_validate_json(json.dumps(listed))
    return MethodAnswer.model_validate_json(
        json.dumps(
            {
                "answer": "decided",
                "method": method,
                "outcome": outcome.outcome,
                "option": outcome.option,
                "reason": outcome.reason,
            }
        )
    )


def verify(request: VerificationRequest) -> MethodAnswer:
    """What verify_<name>() found on the evidence, or the method's own refusal."""
    sent = request.model_dump(mode="json")
    method, name = sent["method"], sent["verification"]
    try:
        found = load_function(Path(request.module), f"verify_{name}")(
            sent["evidence"], sent["settings"]
        )
        if not (
            isinstance(found, tuple)
            and len(found) == 2
            and found[0] in OUTCOMES
            and isinstance(found[1], str)
            and found[1]
        ):
            raise MethodError(
                f"{method}: verify_{name}() must return (result, detail), the result one of "
                + ", ".join(sorted(OUTCOMES))
            )
    except MethodError as e:
        return MethodAnswer.model_validate_json(json.dumps({"answer": "refused", "error": str(e)}))
    result, detail = found
    return MethodAnswer.model_validate_json(
        json.dumps(
            {
                "answer": "verified",
                "method": method,
                "verification": name,
                "result": result,
                "detail": detail,
            }
        )
    )


def respond(line: str) -> MethodAnswer:
    """The answer to one request line, picked by its schema_version."""
    request: MethodRequest | VerificationRequest
    try:
        sent = json.loads(line)
        if isinstance(sent, dict) and sent.get("schema_version") == VERIFY:
            request = VerificationRequest.model_validate_json(line)
        else:
            request = MethodRequest.model_validate_json(line)
    except (ValidationError, ValueError) as e:
        raise MethodError(f"invalid method request: {e}") from e
    if isinstance(request, VerificationRequest):
        return verify(request)
    return answer(request)


def serve(requests: TextIO, answers: TextIO) -> None:
    """One answer line per request line, until the requests end."""
    for line in requests:
        answers.write(respond(line).model_dump_json(exclude_none=True) + "\n")
        answers.flush()


def main() -> None:
    # Answers go to a copy of stdout; stdout itself becomes stderr, so a method that prints
    # can never write a line Rust takes for an answer.
    answers = os.fdopen(os.dup(sys.stdout.fileno()), "w")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    try:
        serve(sys.stdin, answers)
    except MethodError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
