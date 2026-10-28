"""Run methods' decide(ctx) and verify_<name>() (ADR-0063), or a decorated method and the
verdicts of its promises (ADR-0071), one session per walk round.

Run as `python -m sprisk_workers.method`: one MethodRequest or VerificationRequest per line on
stdin, one MethodAnswer per line on stdout, until stdin closes. Rust picks each module from the
loaded catalog and sends only what the method's needs declare; ctx refuses any other read.
"""

import importlib.util
import inspect
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO, get_args

from pydantic import ValidationError

from sprisk_contracts import MethodAnswer, MethodRequest, VerificationOutcome, VerificationRequest
from sprisk_workers.authoring import (
    Binding,
    Choice,
    MethodDeclaration,
    declared,
    declared_method,
)
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
        self._limits = sent.get("limits") or {}
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

    def limit(self, name: str) -> int:
        """A fixed count the method's method.yaml states, such as the most looks."""
        if name not in self._limits:
            raise MethodError(f"{self._method} has no limit {name}")
        value: int = self._limits[name]
        return value

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


def _module(module_path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("sprisk_method", module_path)
    if spec is None or spec.loader is None:
        raise MethodError(f"cannot load method module {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _decorated(module_path: Path) -> Callable[..., Any] | None:
    """The module's decorated method, when it is written that way (ADR-0071)."""
    found = [v for v in vars(_module(module_path)).values() if callable(v) and declared_method(v)]
    if len(found) > 1:
        raise MethodError(f"{module_path} holds {len(found)} methods; a method file holds one")
    return found[0] if found else None


def load_function(module_path: Path, name: str) -> Callable[..., Any]:
    found = getattr(_module(module_path), name, None)
    if not callable(found):
        raise MethodError(f"{module_path} has no {name}() function")
    return found  # type: ignore[no-any-return]


def _arguments(fn: Callable[..., Any], found: MethodDeclaration, ctx: Context) -> dict[str, Any]:
    """The task, and a Binding or None for each concept: never a column name (ADR-0063)."""
    arguments: dict[str, Any] = {}
    for name in inspect.signature(fn).parameters:
        if name == "task":
            arguments[name] = ctx.task
        elif name in found.concepts:
            arguments[name] = Binding() if ctx.bound(found.concepts[name]) else None
        else:
            raise MethodError(f"{fn.__name__}: parameter {name} is neither task nor a concept")
    return arguments


def _decide(fn: Callable[..., Any], ctx: Context, request: MethodRequest) -> Outcome:
    """Run a decorated method. A choice whose promise already broke is never taken again:
    the person is asked to pick one of its fallbacks still open, or, with none, no fair
    option is left (ADR-0071)."""
    found = declared_method(fn)
    assert found is not None
    choice = fn(**_arguments(fn, found, ctx))
    if not isinstance(choice, Choice):
        raise MethodError(f"{fn.__name__} must return method.choose(option, reason=...)")
    broken = ctx.ruled_out(choice.option) if choice.option in found.options else None
    if broken is None:
        return ctx.choose(choice.option, choice.reason)
    broke = found.options[choice.option]
    still_open = {x.root for x in request.options}
    fallbacks = [o for o in broke.fallbacks if o in still_open]
    if not fallbacks:
        raise MethodError(
            f"{broke.label} broke its promise: {broken} No other option is fair here, "
            "so no option is left."
        )
    instead = found.options[fallbacks[0]]
    needs = declared(instead.operator)
    assert needs is not None
    unbound = [
        concept.split(".")[-1].replace("_", " ")
        for name, concept in needs.concepts.items()
        if concept in found.concepts.values()
        and not ctx.bound(concept)
        and inspect.signature(instead.operator).parameters[name].default is inspect.Parameter.empty
    ]
    named = f" It needs the {' and '.join(unbound)} column named." if unbound else ""
    return ctx.ask(
        fallbacks[0],
        f"{broke.label} broke its promise: {broken} {instead.label} would keep it instead." + named,
    )


def answer(request: MethodRequest) -> MethodAnswer:
    """What decide() returned, or the method's own refusal; any other failure is a bug and
    ends the session."""
    method = request.method.root
    try:
        decorated = _decorated(Path(request.module))
        ctx = Context(request)
        if decorated is not None:
            outcome = _decide(decorated, ctx, request)
        else:
            outcome = load_function(Path(request.module), "decide")(ctx)
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
        if _decorated(Path(request.module)) is not None:
            # A decorated promise judged its own outputs; its verdict is in the evidence.
            found = (sent["evidence"].get("status"), sent["evidence"].get("detail"))
        else:
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
