# ADR-0037: Notebooks belong to a flow and keep it in sync
Status: Accepted
Date: 2026-10-18
Arch doc sections: §2A (Notebook views), §4 (domain model). Changes ADR-0036: running a notebook now updates its flow; Create node and Open as notebook are replaced.

## Context
- ADR-0036 kept notebooks apart from flows: a node was made only by picking cells (Create node).
- People expect the notebook and the flow to be one piece of work. They run a notebook, open the flow, and find a different flow.
- The Notebooks page lists every notebook, not the ones of the flow being worked on.

## Decision
- **A notebook belongs to a flow.** `NotebookVersion.pipeline_version_id` names the flow version it was made in or last synced into. A flow is its chain of versions, so the notebook belongs to every later version too.
- **A flow can have several notebooks.** The Notebooks page lists only the notebooks of the flow on screen. New and imported notebooks join that flow.
- **Notebook to flow, on Save and on Run All.** Cells still run at once on the live kernel (ADR-0036). Save and Run All also rebuild this notebook's steps in the flow as a new version:
  - The analyzer splits the code cells into steps (ADR-0031): links between them by variable name, cells that must run together kept together.
  - Each step is a `sprisk.code.python@2.0.0` node whose `from_notebook` names the notebook, its version and its cells.
  - Steps from other notebooks and built-in steps are kept. A name a cell reads from them is linked to the one notebook-made step that makes it, as Create node did.
  - A node keeps its id while it keeps any of its cells, and keeps the settings exposed on it, so history and run reuse follow it.
- **Flow to notebook, when the notebook opens.** If a step's code was edited on the canvas, its cells are rewritten from that code. Edits still unsaved in the notebook are never overwritten: the notebook shows the change and the person picks.
- **Create node is removed.** Saving makes the nodes.
- **Open as notebook is removed.** A flow's notebooks are listed on the Notebooks page.

## Alternatives considered
- **Sync on every cell run.** Rejected by the user: each Shift+Enter would add a flow version.
- **One notebook per flow.** Rejected by the user: a flow can be built from several notebooks.
- **Notebook drives the flow one way only.** Rejected by the user: code edited on the canvas must reach the notebook.

## Consequences (good and bad)
- Good: the notebook and the flow show the same work, without copying between them.
- Good: every save of a notebook is a versioned, compiled flow (rule 5).
- Bad: the analyzer decides the step boundaries; a value that is not a table cannot pass between steps (ADR-0031). Those cells must sit in one cell or the step fails when the flow runs.
- Bad: built-in steps added on the canvas are not cells. A notebook reads their output in the flow, not in its session kernel.
- Bad: removing a notebook's step on the canvas does not remove its cells; the next save brings it back.
- Bad: the link uses the flow versions the app lists (the latest 50); a notebook last synced into an older version drops out of the list.

## Validation
- Tests: steps rebuilt from cells (links, ids kept, settings kept, other steps kept); a name nothing makes is refused; a canvas edit rewrites the cells; unsaved edits are not overwritten; the page lists only the flow's notebooks.
- Browser: run a notebook, Save, open the flow and see its steps; edit a step's code on the canvas, open the notebook and see the cell.
