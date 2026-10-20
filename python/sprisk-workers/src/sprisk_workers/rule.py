"""Run one methodology rule's decide() (ADR-0042).

Run as `python -m sprisk_workers.rule <path/to/rule.py>` with a RuleObservation on stdin;
prints the RuleDecision. Rust picks the module from the loaded rule catalog.
"""

import importlib.util
import sys
from collections.abc import Callable
from pathlib import Path

from pydantic import ValidationError

from sprisk_contracts import RuleDecision, RuleObservation
from sprisk_workers.errors import RuleError

Decide = Callable[[RuleObservation], RuleDecision]


def load_decide(module_path: Path) -> Decide:
    spec = importlib.util.spec_from_file_location("sprisk_rule", module_path)
    if spec is None or spec.loader is None:
        raise RuleError(f"cannot load rule module {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    decide = getattr(module, "decide", None)
    if not callable(decide):
        raise RuleError(f"{module_path} has no decide(observation) function")
    return decide  # type: ignore[no-any-return]


def run_rule(module_path: Path, observation_json: str) -> str:
    try:
        observation = RuleObservation.model_validate_json(observation_json)
    except ValidationError as e:
        raise RuleError(f"invalid rule observation: {e}") from e
    # The module is rule-pack code: its output is checked again, like any input.
    decision = RuleDecision.model_validate_json(
        load_decide(module_path)(observation).model_dump_json()
    )
    if decision.rule != observation.rule:
        raise RuleError(
            f"rule {observation.rule.root} returned a decision for {decision.rule.root}"
        )
    return decision.model_dump_json(exclude_none=True)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m sprisk_workers.rule <path/to/rule.py>")
    try:
        sys.stdout.write(run_rule(Path(sys.argv[1]), sys.stdin.read()))
    except RuleError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
