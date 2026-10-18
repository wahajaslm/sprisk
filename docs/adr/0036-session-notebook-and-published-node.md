# ADR-0036: Notebooks run in a session; a node is made only when the person picks a boundary
Status: Accepted; running a notebook now updates its flow, and Create node is replaced (ADR-0037)
Date: 2026-10-18
Arch doc sections: §2A (Code and notebooks, Notebook security), §4 (domain model), §9 (runs), §11 (worker protocol), §12 (trust boundaries). Node Framework §8.3. Supersedes ADR-0033 and the run path of ADR-0035. Changes ADR-0031's import rule.

## Context
- The notebook view is a view of a `PipelineVersion` (ADR-0033). Every Shift+Enter splits the cells, saves a new version and reruns isolated steps in the workers.
- People compare it with VS Code's notebook and find it different in kind, not in style. There is no shared state. `[n]` is a position, not an execution count. There are no Markdown cells. Only tables cross cells; a model or a dict fails the step (ADR-0031). Each run rebuilds the notebook.
- The Node Framework (§8.3) already names two execution modes: session (a live kernel, shared state) and isolated (declared inputs, artifacts).
- The workers, the cell analyzer, `sprisk.code.python@2.0.0`, the Monaco notebook UI, display capture and `.ipynb` import/export all work. They are kept.
- On 2026-10-18 the user chose to do this before finishing M2.

## Decision
- **Running a cell does not change the flow.** Cells become a node only when the person selects them and creates one. Exploring and publishing are two modes:
  - **Session notebook:** cells share one live Python kernel. Any value can live in it. Cells run in the order the person chooses. `[n]` is the execution count.
  - **Published node:** a `sprisk.code.python@2.0.0` step in a `PipelineVersion`. It runs isolated in a worker, gets only its declared inputs and writes typed artifacts. Nothing about it changes.
- **A notebook is its own saved document.** New entities `Notebook` / `NotebookVersion`: ordered code and Markdown cells, each with a stable cell id. Each save is a new immutable version (rule 5). Outputs are not part of it.
- **The kernel is `ipykernel`, driven by `jupyter_client`** in a Python session host (`python -m sprisk_code.session`). Rust starts it, stops it and checks every request (rule 4, §2A Notebook security). The browser talks only to the Rust API. Rust sends one JSON line per request over stdio, as to workers. A cell's result comes back in the HTTP answer when the cell ends; streaming output while it runs comes later. Kernel and host talk over IPC sockets in a private directory, not TCP ports.
- **Limits on every kernel:** one per notebook, at most 4 at once, 10 minutes per cell, a 4 GB memory cap, shutdown after 30 idle minutes, interrupt and restart. Memory is measured with `psutil` every quarter second, during and between cells; over the cap the kernel restarts and the next answer says so. It is a poll, not an OS limit: a very fast spike can pass it.
- **File access:** the kernel runs in the API's working directory, where workers run, so a relative path reads the same file in the session and in the node made from it. It is a local process with the person's own file access. That is the same trust as a code step today (§12: a trusted local subprocess, not a sandbox). Scoped reads through an SDK come with hosted mode.
- **Session results are scratch.** They are not `Run`s, `Attempt`s or `Artifact`s, and the UI labels them so. Each execution appends two audit events: when it starts (cell id, code hash) and when it ends (status and execution count, or why the kernel stopped). Outputs sent to the browser are bounded: first rows of a table, figure size limits (ADR-0029). The browser never runs code (rule 9).
- **Making a node is explicit: "Create node from cells".** The person selects cells. The existing analyzer (`POST /code/split`, reads but never runs) proposes:
  - Inputs: tables, by variable name.
  - Parameters: top-level literals (`TOP_N = 10`).
  - Outputs: the values later code uses.
  - Displays: what the cells print or draw.
- **The person confirms or edits that contract.** The confirmed node is added to a chosen flow as a new `PipelineVersion`. The node records the `NotebookVersion` and cell ids it came from.
- **Only supported values cross a boundary.** Today that means tables (Parquet). JSON and scalars, files, and models come later, each as its own change. If an unsupported value would cross, the dialog refuses and names the variable, its type and the fix (widen the selection or return a supported value). Arbitrary Python objects are never pickled across.
- **The analyzer assists; it does not decide.** It proposes node boundaries; it never turns a dependency into a graph edge by itself. The notebook warns when cells ran out of order. Name-level warnings (a cell reads a name only a later or deleted cell sets) come later.
- **Where it lives in the UI:** the top-level Notebooks view (ADR-0018) hosts session notebooks in the ADR-0035 Monaco editor, with Markdown cells added. The Flow panel's Flow | Notebook switch is removed. Flow code is still edited in the Inspector's Code tab (ADR-0026). "Open flow as notebook" creates a new `Notebook` from a flow's code.
- **Import** of an `.ipynb` or `# %%` file creates a `Notebook`, not a flow (changes ADR-0031). Export writes `.ipynb` with the session's last outputs.
- **Later, each with its own change:** "Refresh node from notebook" with a visible contract diff; more output codecs.

## Alternatives considered
- **Keep one model (ADR-0033): every cell is a step.** Rejected: no shared state, so normal notebook code fails.
- **Make the session the pipeline (marimo-style).** Rejected: one namespace cannot be scheduled, cached or retried per step (ADR-0031).
- **Our own exec loop instead of ipykernel.** Rejected: we would rebuild display hooks, rich reprs, interrupt and execution counts (no reimplemented machinery).
- **Browser talks to the kernel directly (Jupyter server).** Rejected: it bypasses Rust authorization (rule 4, §2A).
- **Mandatory decorators to mark nodes.** Rejected: people should write plain Python.

## Consequences (good and bad)
- Good: the notebook behaves like Jupyter and VS Code; any Python value works while exploring.
- Good: published nodes keep isolation, caching, scheduling and provenance.
- Bad: a live kernel is state the API must route to. That breaks "stateless API" for two replicas until the kernel host is leased like a worker.
- Bad: two new dependencies (`ipykernel`, `jupyter_client`) and a new contract entity.
- Bad: session results cannot be cited as evidence until they are published as a node and run.
- Bad: the Flow | Notebook switch and its tests are removed.
- Known gaps, each for its own change:
  - The API has no authentication; any local process can run cells (as it can already submit code steps).
  - Cell code can read and write `.sprisk/`, the store, when it sits under the working directory (code steps can too).
  - The leakage check (`split_leakage`) does not look inside code nodes, so a node made from cells is not checked for holdout use.
  - Create node binds inputs to notebook-made steps by name; it warns, but does not prove, that the session's values came from those steps.

## Arch doc edits (made)
- §2A stack table, "Code and notebooks": the kernel protocol is now used; name the session host and Rust relay.
- §2A Notebook security: add the kernel limits and "session results are scratch".
- §4: add `Notebook` / `NotebookVersion` (immutable versions).
- §9: session executions are not runs or attempts.
- §11: add session messages (start, execute, interrupt, restart, output, shutdown) to the worker protocol.

## Validation
- Python tests: state persists across cells; the count increments; interrupt; restart clears state; the time limit fires; the memory cap fails loudly.
- Rust tests: an unauthorized execute is refused; the idle kernel shuts down; audit events are appended.
- Contract round-trip for `NotebookVersion`.
- Create-node tests: the proposal for picked cells; refusal when other cells must join; inputs bound only to notebook-made steps; warnings for unrun, edited and out-of-order cells.
- Browser (done 2026-10-18): a new notebook loads `sales_data.csv`, computes the top products and draws them; cells 2–3 become a node in a new flow; Run graph succeeds with the same table.
- Refusal test: a model crossing the boundary is refused with its name and type.
- Browser: run cells out of order and see `[n]` follow; add a Markdown cell; create a node; run the flow.
