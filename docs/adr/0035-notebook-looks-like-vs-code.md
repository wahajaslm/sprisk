# ADR-0035: The notebook view is a VS Code-style notebook on Monaco
Status: Accepted
Date: 2026-10-17
Arch doc sections: §2A (Notebook views). Supersedes ADR-0034. Keeps ADR-0033 (one saved version, two views).

## Context
- ADR-0034 put JupyterLab's own notebook widgets in the Flow panel. People found it unpolished: a cramped toolbar, plain-text outputs, a screen that does not feel like a modern notebook editor.
- The reference people use is VS Code's notebook editor.
- VS Code's notebook is built on Monaco, VS Code's editor. sprisk already uses Monaco for code (ADR-0020).

## Decision
- **The notebook is sprisk's React view on Monaco, laid out as VS Code's notebook editor:** a top toolbar (+ Code, Run All, Export, kernel name on the right); per cell a run button and `[n]` in the left gutter, a blue focus bar on the selected cell, a hover toolbar on the cell's top edge, a status line under the editor (✓ or ✗ and its state, the language), outputs under the cell, and "+ Code" between cells on hover.
- **VS Code's keys:** Shift+Enter runs and moves to the next cell, Ctrl/Cmd+Enter runs; with a cell selected and no editor focused, A and B add a cell above or below, D D deletes, Enter edits, arrows and J/K move, Esc leaves the editor.
- **Rich outputs:** printed text, the first rows of each table a step made or showed, figures, and errors with their message.
- **Unchanged from ADR-0033/0034:** one saved version, two views; Run saves the next version through `POST /code/split` and runs it in sprisk's workers; a built-in step is its call, with its code behind a toggle; the notebook hides the Inspector tabs; `.ipynb` export.
- **JupyterLab's packages are removed,** with their Vite plugin, deduplication, React override and jsdom stubs.

## Alternatives considered
- **Restyle JupyterLab's widgets to look like VS Code.** Rejected: its cells have no gutter run button, status line or hover toolbar; the styles would fight its DOM.
- **Keep ADR-0034.** Rejected by its users.

## Consequences (good and bad)
- Good: the same editor as VS Code; about 340 fewer packages and no 1.4 MB chunk.
- Bad: notebook behaviours (keys, focus, insertion) are sprisk's code to keep correct.
- Bad: no run times yet: an attempt records when it was made, not how long it ran.

## Validation
- Tests: the view's cells, outputs, run, add, delete, keys, refusal, export, selection.
- Browser: screenshots compared with VS Code's notebook; edit and run a cell; add and delete with keys.
