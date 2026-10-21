# ADR-0054: A flow's notebook shows every step's code, and is made when the flow has none
Status: Accepted
Date: 2026-10-21
Arch doc sections: §2A (Notebook views). Builds on ADR-0028, ADR-0036, ADR-0037.

## Context
- The Notebooks page lists a flow's notebooks (ADR-0037). A flow built on the canvas or through the API has none, so the page is empty.
- "Sync from flow" makes notebooks from the flow, but only when a person clicks it, and it has no tests.
- It writes a built-in step as one call line, such as `model_model = model(train=split_train, ...)`. The function is named by the step, and nothing defines it. So the notebook does not run, and a person cannot read the code that runs.
- `GET /operators/{id}/source` already serves each operator's module, with the digest of the code the workers run. The Code tab shows it.
- Saving or running a notebook rebuilds its code cells into steps (ADR-0037). A call line or a heading `### Stage Step: \`<id>\`` tells which built-in steps a notebook shows, but each call cell was still rebuilt into a code step, duplicating the built-in one.

## Decision
**A flow with no notebook gets one, once.**
- When the Notebooks page shows a flow with no notebook, and no notebook outside a flow that it would list, it makes the flow's notebook, as "Sync from flow" does. It runs nothing.
- The page asks once per flow, even when React runs the effect twice.
- "Sync from flow" stays, to make the notebook again after the flow changes.

**Each built-in step is three cells, in flow order.**
- A Markdown heading: `### Stage Step: \`<id>\``.
- A Markdown cell naming the operator and its file, then its whole module, from `GET /operators/{id}/source`, in a Python code fence. It is for reading.
- A code cell: `from <module> import <function> as <id>`, from the operator's entrypoint, then the call line. It runs in the flow's kernel, which has the workers' packages.
- Saving treats a code cell with that import as its built-in step, not a new code step. A person's cell that reads a call's output by the name the call wrote (`split_train`) is linked to that step's port (`split.train`). The import, not the call alone, marks the cell: a person's own `load()` is not the flow's `load` step.
- Code steps and notebook-made steps keep their own source, as today.

**The source is Markdown, not code.**
- Saving rebuilds only code cells into steps. As Markdown, a step's code is shown and never copied into a code step that would duplicate the built-in one.
- A plugin module imports its own package (`from .costs import ...`), so pasted as code it would not run anyway.
- Editing a built-in step's code stays the Code tab's copy on edit (ADR-0028).

## Alternatives considered
- **The source as a code cell.** Rejected: saving would turn it into a code step beside the built-in one, and relative imports fail outside the package.
- **Show a generated notebook without saving it.** Rejected: a session notebook runs only from a saved version (ADR-0036).
- **Only the function, not the whole module.** Rejected for now: cutting one function out needs a parser in the browser or a new route; the module is what the digest covers.

## Consequences (good and bad)
- Good: every step's code can be read in the notebook, and the notebook runs in the flow's kernel.
- Good: the Notebooks page is never empty for a flow.
- Bad: a whole module is shown for each built-in step; `sprisk_ml/compare.py` is about 600 lines.
- Bad: the notebook is made once. After the flow changes, a person syncs again.
- Bad: two browsers opening the same new flow at once could each make one.

## Validation
- Tests, first for what exists: a built-in step becomes a heading, its source and a runnable call; saving the generated notebook adds no step and drops none; a flow with no notebook gets one, once; a flow with one gets none.
