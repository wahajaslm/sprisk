# ADR-0041: Notebooks can be deleted and renamed, and a cell's output shows while it runs
Status: Accepted
Date: 2026-10-18
Arch doc sections: §2A (Notebook views), §4 (`Notebook` / `NotebookVersion`), §11 (session host protocol). Changes ADR-0036: "streaming output while it runs comes later" is now done.

## Context
- A notebook cannot be deleted or renamed from the Notebooks page.
- A cell's output arrives only when the cell ends. A long cell looks stuck.
- Notebook versions are immutable (rule 5). A notebook's steps live in its flow (ADR-0037).

## Decision
- **Delete is a last version, not an erase.** Deleting saves a new `NotebookVersion` with `removed: true`. The notebook is no longer listed; its history stays readable by id.
- **Deleting takes the notebook's steps out of its flow first.** The page saves a new flow version without the nodes whose `from_notebook.notebook_id` is this notebook, and their edges. If another step reads one of their outputs, nothing changes and the page names those steps. The flow is saved before the notebook, so a failed delete can be retried.
- **Rename changes only the title.** It saves a new version with the same cells and flow version. It does not rebuild steps, and node ids stay.
- **Output streams while a cell runs.** The session host answers `execute` with `NotebookExecutionEvent` lines. While the cell runs, a `running` event carries every output so far, at most about every 0.3 s and only when something changed. The last line is a `done` event with the `NotebookExecution`. Rust checks each line against the contract.
- **The browser asks for the stream.** `POST /notebooks/{id}/execute` with `Accept: application/x-ndjson` answers one event per line as they come. Without it, the answer is the `NotebookExecution` as before. One route for both (rule 4).
- **A running event repeats all outputs, not a diff.** `clear_output` and capped text then need no merge logic in the browser.

## Alternatives considered
- **Delete the rows.** Breaks rule 5 and loses what the flow's steps were made from.
- **Server-sent events on a second route.** Two routes for one execution, and the cell's result could arrive on either.
- **Send only new outputs per event.** Smaller lines, but the browser must replay `clear_output` and text appends exactly as the host does.

## Consequences (good and bad)
- Good: a long cell shows its prints and plots as they come.
- Good: history is never lost; a deleted notebook can be read by id.
- Bad: a cell with large figures resends them in each running event; the throttle and the output caps bound it.
- Bad: delete is two saves. A failure between them leaves the notebook listed with no steps; deleting again finishes it.

## Validation (how we will know it was right)
- A cell that prints, sleeps and prints again shows the first line before it ends.
- A deleted notebook's steps are gone from a new flow version, and it is not listed; a step read by others blocks the delete with its name.
- A renamed notebook keeps its node ids and flow.
