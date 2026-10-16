# ADR-0025: The code decides the tabs: one rule for every step
Status: Accepted
Date: 2026-10-16
Arch doc sections: §2A (Inspector), §7 (operators), §9 (manifest), §11 (worker protocol). Builds on ADR-0020, 0021, 0022, 0024.

## Context
- The Inspector tabs were filled from two sources: the AST for code steps, the manifest for built-in steps. Each tab grew its own logic.
- Things leaked: load's file path showed under Parameters; chart choices under Parameters; built-in steps had no Console.

## Decision
One rule, read from the code, for every step, built-in or the user's:

| Tab | Shows | Read from |
| --- | --- | --- |
| Inputs | everything read from outside: tables and models from other steps, and files | arguments typed as a table, model or `pathlib.Path`; in code steps, `read_csv("x.csv")` and similar calls |
| Parameters | tunable values only | plain value arguments; in code steps, top-level literals |
| Data | every table or value produced | returned values |
| Visualizations | every figure produced | returned figures (ADR-0024); plots drawn while running |
| Console | stdout, stderr, warnings, errors | captured by the worker for every step |
| Code | the code | the source |

- **The code is the source; the manifest is checked against it.** At load the worker requires: every table or model input port is an argument; every argument typed `pathlib.Path` is a setting marked `x-sprisk-local-path` (the API checks it stays inside the data roots); nothing else. A step that breaks the rule does not load.
- **Paths are inputs.** A setting marked `x-sprisk-local-path` stays in the step's params on the wire (the API needs it there for the data-root policy) but the Inspector shows it under Inputs, never Parameters.
- **Console for every step.** The worker captures stdout, stderr and warnings around every step call and writes them as one reserved output, `console`, in the CodeDisplay format (text items only). The scheduler accepts `console` on any step in addition to its declared ports. Code steps keep their own ordered display.
- View settings (`x-sprisk-show-in: visualizations`) stay next to the figure.

## Alternatives considered
- **Keep the manifest as the source and add more markers.** Rejected: it drifts from the code; that drift is what leaked.
- **Generate manifests from code.** Deferred: manifests also carry resources, effects and descriptions; checking is enough today.
- **Console through a new worker message.** Rejected: an output artifact is cached, versioned and shown like any other.

## Consequences
- Good: one rule, testable across all steps; new steps land in the right tabs without UI work.
- Good: built-in steps explain themselves in Console.
- Bad: every step run may write one small extra artifact.

## Validation
- A test loads every step and checks the rule (inputs, paths, ports).
- The Inspector never shows a path under Parameters (test).
