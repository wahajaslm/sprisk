# ADR-0028: A step in a flow can carry its own code
Status: Accepted
Date: 2026-10-16
Arch doc sections: §7 (operators), §9 (versions, caching, implementation digest), §11 (worker protocol), §12 (untrusted code). Builds on ADR-0020, 0022, 0025.

## Context
- Every step's Code tab shows its real code (ADR-0022, ADR-0025: the code decides the tabs).
- Built-in steps were read-only, so changing what a step does meant rebuilding it as a code step with a different shape.
- People expect to edit a step's code in place.

## Decision
- A pipeline node may carry `code`: `{ source, function }`. The step keeps its operator: inputs, outputs, settings and manifest checks stay those of the operator. The code replaces its implementation in this version only.
- Rust: a node with `code` uses `sha256(source)` as its implementation digest, so the cache, `reuse_run_id` (ADR-0026) and history treat it as different code. The original operator is unchanged in the library.
- The lease carries `code`. The worker loads `function` from `source` in the code-step runner, the only module allowed to `exec` (ADR-0020), then calls it through the same plain-function adapter: signature, types and port checks as any step (ADR-0022, ADR-0025).
- The code runs with the same trust as a code step: the user's own code in their own worker. No new permission.
- UI: the Code tab offers Edit; Run saves a new version with the node's `code`; Revert to built-in saves a version without it. The canvas marks an edited step.

## Alternatives considered
- **Turn the step into a code step.** Rejected: code steps have one input and fixed ports; multi-input steps (impute, evaluate) would lose their shape.
- **Fork into a new operator in the library.** Rejected for now: a library change for a one-flow edit; plugins need packaging and review (§15.1).

## Consequences
- Good: any step's code is editable where it is read; history keeps every edit.
- Bad: an edited step no longer gets fixes to its built-in operator; the canvas marks it so this is visible.

## Validation
- Worker test: a lease with `code` runs the edited function with the operator's checks.
- Compiler test: a node's `code` changes its implementation digest.
- Browser: edit impute's code, run, see the new result; revert.
