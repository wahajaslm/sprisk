# ADR-0034: The notebook view is JupyterLab's own notebook, with sprisk as its kernel
Status: Superseded by ADR-0035
Date: 2026-10-17
Arch doc sections: §2A (Notebook views, notebook security), §14 (stack). Builds on ADR-0033 (one saved version, two views); replaces its hand-made notebook screen.

## Context
- ADR-0033 made a flow readable and editable as notebook cells, drawn by sprisk.
- People said a notebook that only looks like Jupyter is not acceptable: the layout, keys and outputs must be Jupyter's.
- A real Jupyter kernel is ruled out: one shared memory space bypasses workers, versions, caching, retries and the sandbox (hard rules 3–5, ADR-0031).

## Decision
- **The screen is JupyterLab's.** `@jupyterlab/notebook`, `cells`, `codemirror`, `rendermime` and the JupyterLab Dark theme draw the notebook: prompts, cells, editor, outputs, collapsed input, active-cell bar.
- **There is no kernel.** Run (Shift+Enter, Ctrl+Enter, the toolbar) reads the cells and saves the next version through ADR-0033's path (`POST /code/split`, Rust compiles), then runs it in sprisk's workers. The toolbar names the kernel "Python · runs in sprisk".
- **A run fills the cells as a kernel would.** `[n]` when the step ran, `[*]` while it runs; outputs are the step's saved artifacts turned into Jupyter outputs: printed text as streams, tables as DataFrame HTML (escaped: rule 7), figures as SVG, Plotly or Vega-Lite, failures as errors. A built-in step shows each table's size; its rows stay in the store (rule 9).
- **A built-in step is two cells:** its code, collapsed (editable where ADR-0028 allows), then its read-only call. A downloaded `.ipynb` has the same cells.
- **Jupyter's keys:** A, B, X, C, V, D D, Z, Enter, Esc, arrows, J, K, as in JupyterLab.
- **The notebook hides the Inspector tabs:** outputs are under each cell, as in Jupyter. The canvas shows them again.
- **The toolbar is sprisk's markup with JupyterLab's classes and icons.** JupyterLab 4's toolbar buttons are web components whose design tokens loop forever outside the JupyterLab app.
- **Packaging:** the notebook is a lazy chunk (≈1.4 MB, 380 kB gzip) loaded when the notebook is first shown. A Vite plugin gives JupyterLab its icons as SVG text (its own build uses raw-loader). `yjs` and CodeMirror are deduplicated. One React (19) for the app and JupyterLab, by pnpm override.

## Alternatives considered
- **sprisk's own Jupyter look-alike (ADR-0033's screen).** Rejected by the user: not Jupyter.
- **A real Jupyter server and kernel.** Rejected: breaks hard rules 3–5; results would depend on click order.
- **`@datalayer/jupyter-react`.** Rejected: built around a Jupyter server and kernel.

## Consequences (good and bad)
- Good: the notebook is Jupyter's screen and keys; results stay versioned, cached, sandboxed and traceable.
- Good: the downloaded `.ipynb` opens in JupyterLab looking the same.
- Bad: about 340 new packages and a 1.4 MB chunk. Upgrades follow JupyterLab's releases (pinned at 4.5.11).
- Bad: JupyterLab asks for React 18; we force React 19. A JupyterLab upgrade must be checked for this.
- Bad: Lumino widgets live outside React; the view bridges them (attach, detach a tick after React's commit).
- Bad: newer `yjs` prints harmless "premature access" warnings from inside JupyterLab's cell models.

## Validation
- Tests: cells ↔ steps, sprisk outputs → Jupyter outputs (escaping), the view in jsdom (cells, outputs, run, add, refusal, download, selection, Inspector hidden).
- Browser (checked): penguins flow as a notebook; edit a cell and Shift+Enter saves, runs and shows its output under it; B and D D add and delete cells; switching views has no console errors.
