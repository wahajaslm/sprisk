# ADR-0020: Code steps run the user's Python as a recorded pipeline step

Status: Accepted
Date: 2026-10-16
Arch doc sections: §2, §5, §9, §12
Related: ADR-0017, ADR-0019 (§7 custom code)

## Context

- Users already know Python. A platform that needs a wrapper operator for every library
  call will always lag behind it, and users will not switch.
- What a plain script lacks is not features but a record: which code ran on which data,
  cached reruns, leakage checks, and comparison between runs.
- ADR-0019 §7 allows explicitly authorized custom-code nodes. This ADR makes them a normal
  part of the flow.

## Decision

1. **A code step is an ordinary operator, `sprisk.code.python`.** Its source is a param,
   so it is part of the immutable `PipelineVersion`. Editing code creates a new version.
2. **It runs only in a Python worker**, through the same lease and attempt path as any
   step. The API and the browser never execute it (rules 3, 9).
3. **Notebook-like display.** The cell sees its input as `data` (a polars DataFrame).
   The value of the last expression, printed text and open matplotlib figures become a
   `CodeDisplay` artifact (contract), capped in rows, characters and image bytes.
4. **Errors are the user's.** An exception in user code fails the attempt permanently
   (`code_error`, with the traceback). It is never retried.
5. **Trust.** A code step is code the user wrote and runs on their own machine, with the
   same trust as running the script locally. Code proposed by AI is shown to the user and
   needs their explicit run, never an automatic one (rule 3). Isolation for shared or
   hosted use follows the plugin isolation item in the backlog (arch §12).
6. **Checks see the edges, not the inside.** Methodology checks reason about which ports a
   code step reads and writes. A code step that reads a test split before selection is
   flagged like any other step.

## First slice

- One input (`data`), one output (`display`). Passing data on to later steps (`output`)
  is the next slice.
- The UI adds a code step from a table output ("Explore in code"), edits it in the Code
  tab and runs it. Saving creates a new pipeline version and a run.

## Consequences

- Good: anything Python can do, a flow can do, while keeping run history.
- Good: new operators can come from code steps that proved useful ("promote"), rather
  than being written up front.
- Cost: a code step is opaque to methodology rules beyond its ports.
- Risk: arbitrary code in the worker. Accepted for local single-user mode only.
