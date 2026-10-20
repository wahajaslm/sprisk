# ADR-0045: A rule manifest holds only what the system uses
Status: Accepted
Date: 2026-10-20
Arch doc sections: §8, §15.1. Amends ADR-0042.

## Context
- A rule is a manifest (`rule.yaml`) and a `decide()` function (`rule.py`). ADR-0042 keeps the logic in Python.
- Yet manifests carry text nothing runs: `condition` looks like logic, `observes` lists inputs no one checks. Both drifted from the code: the clustering rule read three question facts that are never sent, and its tests passed by sending them by hand.
- Which rule decides which step is a list in Rust (`rule_for`), so a new rule needs a Rust edit (§15.1).

## Decision
- **Every field of an active rule's manifest is used by the system.** Nothing in it is documentation alone.
- **`status: draft | active`.** A draft has no `rule.py` and is never run; its `condition` and `observes` stay as design notes. An active rule has `rule.py`, and the catalog refuses it with `condition` or `observes`.
- **`applies_to`**: the operators (without version) whose steps the rule decides. Rust routes from it; two active rules on one operator are refused when packs load.
- **`reads`**: the facts the rule may read, from one fact catalog in `sprisk-methodology` (`question.target`, `flow.model_families`, `step.*`, `rows`, `column.*.kurtosis`, …). An unknown name is refused when packs load. Rust sends only what the rule reads, and fetches train rows only for a rule that reads them.
- **`examples`**: inputs (`given`) and the alternative the rule picks (`picks`). They run as tests for every active rule, each returning every alternative in the menu; a test run also fails when `decide()` reads a fact it did not declare. The Methodology page shows them instead of `condition`.
- `decide()` stays the only logic.

## Alternatives considered
- **Keep `condition` as prose and add drift tests.** Rejected: two places still describe one behaviour.
- **Make `condition` executable (a rule language).** Rejected in ADR-0042: a second language.
- **Generate the manifest from Python.** Rejected: Rust and the UI must read the menu without running Python, and a generated file is one more thing to keep fresh.

## Consequences (good and bad)
- Good: changing `decide()` that changes a choice fails an example, so behaviour changes are deliberate.
- Good: a new rule is one folder; no Rust edit.
- Good: a rule cannot depend on a fact that is never sent.
- Bad: a new fact still needs Rust to produce it and an entry in the fact catalog.
- Bad: the clustering rule loses its geometry, soft-membership and noise inputs until the question records them.

## Validation
- An active rule with a `condition`, an unknown fact in `reads`, or no example fails when packs load.
- An example that picks another alternative, or a `decide()` reading an undeclared fact, fails the test run.
- `rule_for` is gone; the five active rules route from `applies_to`.
