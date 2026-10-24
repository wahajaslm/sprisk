"""Run methods' decide(ctx) (ADR-0063), one session per walk round.

Run as `python -m sprisk_workers.method`: one MethodRequest per line on stdin, one MethodAnswer
per line on stdout, until stdin closes. Rust picks each module from the loaded catalog and
sends only what the method's needs declare; ctx refuses any other read.
"""

import importlib.util
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

from pydantic import ValidationError

from sprisk_contracts import MethodAnswer, MethodRequest
from sprisk_workers.errors import MethodError


@dataclass(frozen=True)
class Outcome:
    outcome: str
    option: str
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

    def bound(self, concept: str) -> bool:
        """Whether a binding names the concept. Never which column: decide() reads no names."""
        self._declared("concepts", concept)
        return concept in self._bound

    def choose(self, option: str, reason: str) -> Outcome:
        return Outcome("choose", self._option(option), reason)

    def ask(self, option: str, question: str) -> Outcome:
        return Outcome("ask", self._option(option), question)

    def _declared(self, kind: str, name: str) -> None:
        if name not in self._needs[kind]:
            raise MethodError(f"{self._method} reads {kind} {name} without declaring it")

    def _option(self, option: str) -> str:
        if option not in self._options:
            raise MethodError(f"{self._method} has no option {option}")
        return option


Decide = Callable[[Context], Any]


def load_decide(module_path: Path) -> Decide:
    spec = importlib.util.spec_from_file_location("sprisk_method", module_path)
    if spec is None or spec.loader is None:
        raise MethodError(f"cannot load method module {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    decide = getattr(module, "decide", None)
    if not callable(decide):
        raise MethodError(f"{module_path} has no decide(ctx) function")
    return decide  # type: ignore[no-any-return]


def answer(request: MethodRequest) -> MethodAnswer:
    """What decide() returned, or the method's own refusal; any other failure is a bug and
    ends the session."""
    method = request.method.root
    try:
        outcome = load_decide(Path(request.module))(Context(request))
        if not isinstance(outcome, Outcome):
            raise MethodError(f"{method}: decide() must return ctx.choose or ask")
    except MethodError as e:
        return MethodAnswer.model_validate_json(json.dumps({"answer": "refused", "error": str(e)}))
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


def serve(requests: TextIO, answers: TextIO) -> None:
    """One answer line per request line, until the requests end."""
    for line in requests:
        try:
            request = MethodRequest.model_validate_json(line)
        except ValidationError as e:
            raise MethodError(f"invalid method request: {e}") from e
        answers.write(answer(request).model_dump_json(exclude_none=True) + "\n")
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
