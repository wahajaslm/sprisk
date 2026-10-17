# ADR-0033: A flow can be read and edited as a notebook
Status: Accepted
Date: 2026-10-17
Arch doc sections: §2A (Notebook views, notebook security), §5 (typed pipeline IR). Builds on ADR-0028, 0031.

## Context
- People think in notebooks and in flows. ADR-0031 turns a notebook into a flow once, at import.
- They want both ways, at any time: build on the canvas and read it as a notebook; edit a cell and see the canvas change.
- Two copies that sync would drift. Each step runs on its own and only tables cross steps (ADR-0031).

## Decision
- **One source of truth: the saved `PipelineVersion`.** The Notebook view and the canvas are two views of it. Every edit in either saves a new version (rule 5); both re-render from it. Nothing notebook-specific is saved.
- **A Flow | Notebook switch** in the Flow panel picks the view. The Inspector, runs and selection are shared. View choice is layout state (rule 9).
- **Cell order:** steps in dependency order, keeping the saved node order where it is already valid. A notebook import keeps its cell order.
- **A step is one cell, or several.** A code step (`sprisk.code.python@2.0.0`) keeps its cells apart with `# %%` lines in its source. When cells must run together (one defines a function another uses), the analyzer keeps them in one step and the notebook still shows each cell, bracketed as one step.
- **Editing a code cell re-reads the links.** The browser sends every cell, in order, to `POST /code/split` (Python reads, never runs). Each other step goes as a stand-in line that reads and sets its variable names (`impute_train = impute_test = object(split_train)`), so links to and from built-in steps are found too. The result becomes the next version: inputs, outputs and edges of code steps; built-in steps and their edges are kept. Node ids are kept where a cell keeps its step, so history and reuse (ADR-0026) follow it.
- **A stand-in may not join a code group.** If cells that must run together have a built-in step between them, the edit is refused with the name and the fix.
- **A built-in step is a cell too.** It shows a read-only call line (`impute_train, impute_test = impute(train=…, test=…, method="median")`) and its code. Editing the code makes this flow's own copy of the step (ADR-0028). The library is never changed. Settings change in the Inspector. Steps that read files or have effects stay read-only (ADR-0028).
- **A built-in step's output is named `<step>_<port>`** in the notebook, unless a code step already reads it by another name.
- **Download .ipynb.** One code cell per notebook cell. A built-in step becomes its code plus its call line, so the notebook runs in plain Jupyter where its imports are installed. A v1 code step gets `data = …` before its code and a small `sprisk.output` stand-in.
- **Edits run as in the Code tab:** Run saves the new version and runs from the edited step.
- **Later, each with its own change:** save a flow's edited step as a new operator plugin; exposed settings written into the exported code.

## Alternatives considered
- **A separate notebook document synced with the flow.** Rejected: two records of one analysis drift, and the notebook would be hidden state.
- **One cell is always one step; refuse edits that need merging.** Rejected by the user: the notebook should look like what they wrote.
- **Merge cells into one cell.** Rejected: rearranges the person's code.
- **A graph library for the order.** Rejected: none in the stack gives "dependency order, keeping the saved order"; it is a short function.

## Consequences (good and bad)
- Good: one analysis, two views; no sync code, no drift.
- Good: every notebook edit is a versioned, compiled `PipelineVersion` (rule 3, rule 5).
- Bad: a code-cell edit costs one `POST /code/split` round trip before it saves.
- Bad: a copied import or literal (ADR-0031) is visible at the top of the cell that uses it.
- Bad: exported built-in code that imports other sprisk modules still needs that package.

## Validation
- Python test: cells kept together keep `# %%` between them.
- TS tests: order; flow → cells; edited cells → next version (ids, edges to built-ins, merge, refusal); `.ipynb` export.
- Browser: penguins flow as a notebook; edit a cell, the canvas changes; add a cell, a node appears; download and open the `.ipynb`.
