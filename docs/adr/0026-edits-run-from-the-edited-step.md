# ADR-0026: An edit runs from the edited step onwards; Run graph runs from the start
Status: Accepted
Date: 2026-10-16
Arch doc sections: §9 (runs, attempts, caching), §11 (API). Builds on ADR-0005 (append-only history).

## Context
- Every edit (a setting, a chart choice, code) saves a new version and runs it.
- Unchanged pure steps come from the cache, but sources (`load` reads a file that can change) and the methodology gate always ran again, and a new worker started: about 3.6 s for a one-chart change.
- People expect an edit to recompute only the edited step and what depends on it.

## Decision
- `CreateRun` gains optional `reuse_run_id`. The run records it.
- With it, a step whose definition key (operator, code digest, params, input content hashes) equals the key of its finished attempt in that run reuses that attempt's outputs as a `cache_hit`, whatever its effects. Side-effecting steps never reuse.
- Every finished attempt records its definition key (`step_keys`), so the comparison is exact.
- Upstream of an edit, keys are equal, so results are reused; from the edit onwards, params or input hashes differ, so steps run.
- The UI passes `reuse_run_id` (the run on screen) for edits. Run graph never does: it runs from the start, re-reading sources.
- The methodology gate still runs for every new version (its input is the version).

## Alternatives considered
- **Make sources cacheable.** Rejected: a file can change; Run graph must re-read it.
- **Run a sub-graph only (skip downstream).** Rejected: downstream results would silently describe old inputs.

## Consequences
- Good: edits are fast and history stays append-only; each reuse is a recorded `cache_hit`.
- Bad: an edit keeps a source's earlier read even if the file changed since; Run graph is how to re-read.

## Validation
- Scheduler test: with `reuse_run_id`, an unchanged source is a `cache_hit` and the edited step and its dependents run.
- A chart change completes in under a second on the penguins flow (excluding worker start).

## Amendments
- 2026-10-24: **Run from a step.** A step's run button promised "run from here", but a run could only reuse every unchanged step, so an unchanged step never ran again.
  - `CreateRun` gains optional `run_from_node_id`, and the `Run` records it. That step and every step after it run again, even where unchanged, skipping both the reused run and the shared cache. Steps before it are reused or cached as before.
  - The step must be in the version; otherwise the request is refused (`unknown_step`).
  - This is not the sub-graph run rejected above: every step after the start step still runs, so no result describes old inputs.
  - Use: a source file changed (re-read it without re-running everything before it), or a step whose result is in doubt.
  - Validation: scheduler tests (the step and its dependents are leased, steps before it are `cache_hit`, the shared cache is skipped, an unknown step is refused) and an API test (a run from `load` reads the file again).
