# ADR-0055: A flow is its notebooks: one notebook per stage, one cell per step
Status: Accepted
Date: 2026-10-21
Arch doc sections: §2A (Notebook views), §4 (domain model), §9 (runs). Supersedes ADR-0037 and ADR-0054. Changes ADR-0031 (one cell is one step), ADR-0026 (a run can target one step; code steps can be reused) and ADR-0036 (flow notebooks have no session kernel).

## Context
- People come from Jupyter. They expect to work in a notebook, and the flow to show the same work.
- Today the flow and its notebooks are two copies of the steps. The web app copies between them (ADR-0037) and finds a step's cell by its text: `### Stage Step`, `# Flow step:`, `<step>_<port>`, a call named after the step.
- The copies drift:
  - A setting changed in the form never reaches the cell.
  - A step deleted on the canvas leaves its cells, and the next save brings it back.
  - Editing a call's arguments in a cell changes nothing.
- A built-in step shows as its whole module plus an import with sprisk's internal names (`from sprisk_ml.models import random_forest as model`). It does not read as a notebook.
- The analyzer merges cells into one step when a value that is not a table crosses them (ADR-0031). So a person cannot tell which cell is which step.

## Decision
**One record.** The flow (`PipelineVersion`) holds every cell. Notebooks and the canvas are two views of it. Nothing is copied, so nothing drifts.
- A stage (Explore, Split, Clean, Model, Evaluate) is one notebook. A code cell is one step. A cell's id is its step's id.
- **A step does one thing** (a rule, from the user). One load, one split, one model, one chart per step. Never pack several charts or tasks into one cell: the canvas and the notebook must show the analysis step by step.
- `Node.stage` places a step in a stage. Absent: the stage its operator implies, as today.
- `Node.notes` holds the Markdown cells shown before the step (`before`) and, for the last step of a stage, after it (`after`).
- Cell order is the order of `nodes`, by stage. A cell reads only names set by cells above it or in earlier stages.
- New flow notebooks are no longer `NotebookVersion`s. Old ones stay readable (rule 5).

**Sync is automatic, because there is nothing to sync.**
- Editing a cell saves a new flow version when the person runs the cell or leaves it, and only if its code changed. No Save button, no "Sync from flow".
- Every canvas edit (add a step, change a setting, delete a step) is a new flow version, and the notebook shows it at once.

**A ready-made step is a form cell, as in Hex and Deepnote.**
- In the notebook it shows its title, its inputs, its settings as the same form the canvas inspector shows, and the names of its outputs: `Split rows · data: loans · test fraction 0.2 · seed 0 → train, test`.
- Changing the form saves a new flow version. The canvas and the notebook show the one form, so they cannot disagree.
- "+ Step" in a notebook adds a ready-made step there, as the step library does on the canvas. "+ Code" adds a code cell.
- "Show code" shows the function behind the step, read only. "Convert to code" makes it an editable code cell holding that function and its call (ADR-0028).
- `Node.names` keeps the variable each output goes by (`{"train": "train", "test": "test"}`), so code cells can read it. Absent: the port name, or `<step>_<port>` when another step's output has that name.
- No code is written or read for a ready-made step, so a person never sees an import of sprisk's own code.

**Every other cell is a code step, read by Python.**
- One cell is one step. Cells are never merged.
- Each name is set by one cell. A second cell setting it, or changing it in place (`df["x"] = ...`), is refused with both cell numbers. The person writes a new name (`df2 = ...`).
- Arrows come from names: a cell that reads a name another cell set is linked to it.
- A value passed between cells may be a table, a model, or plain data (numbers, text, lists, dicts). A new code operator, `sprisk.code.python@3.0.0`, has ports of any of these kinds. The worker stores each by what it is. Anything else (an open file, a generator) fails the step, naming the value.
- Imports, constants and functions are not passed. Each step gets a copy of the ones it uses from the cells above, in its own `setup` setting. Its source stays exactly as the cell shows it.

**Running a cell runs its step.** A cell's code is text until it runs; when the cell runs, so does the step.
- Run cell saves the flow version if the code changed, then runs that step through the scheduler (rule 4). `CreateRun.target` names the step.
- Steps above it that already ran with the same code, settings and inputs are reused (ADR-0026), code steps included. Steps above it that never ran, or changed, run first.
- Steps below it keep their last results, shown as out of date until they run again.
- The cell's output is the step's output: printed text, tables and figures, as the inspector shows them. The flow shows the same result.
- Run all in a notebook runs its stage. Run flow runs every step from the start and re-reads files (ADR-0026).
- Flow notebooks have no session kernel (ADR-0036 stays for notebooks outside a flow). No hidden state: what a cell sees is what its step was given.

## Alternatives considered
- **Keep two copies and sync them better.** Rejected: matching by text is the cause of the drift, and better matching is still matching.
- **The notebook is the record; the flow is drawn from it.** Rejected: the scheduler, caching, Gate B and AI proposals work on typed steps (§9, rule 3). A notebook run top to bottom has none of that.
- **A ready-made step as one Python call (`from sprisk import random_split`), read back with `ast`.** Rejected by the user: people writing in a notebook would have to learn sprisk's functions and a strict call shape.
- **Raw scikit-learn calls as ready-made steps.** Rejected: a step like `impute` is safe by design (it learns only from train). Raw calls lose that, and a card cannot describe a fit-then-transform pattern.
- **Run cells on a live kernel and run the flow separately.** Rejected by the user: a cell and its step must be one thing. A kernel also keeps hidden state, so its results can differ from the flow's.
- **Merge cells that share a non-table value (ADR-0031).** Rejected: a person can no longer tell which cell is which step.

## Consequences (good and bad)
- Good: the notebook, the canvas and the form can never disagree.
- Good: code cells are plain Python, and ready-made steps are forms, as in Hex and Deepnote. Nobody needs to know a sprisk import.
- Good: removes the sync code, the cell markers and the per-notebook copies of steps.
- Bad: stricter than Jupyter. One cell per name, and no in-place change to another cell's value.
- Bad: each cell run starts a worker, about 1 to 2 seconds before the code starts. A warm worker per flow would remove it; that is its own ADR.
- Bad: a code step that reads a file directly is reused until its cell runs again or Run flow, as in Jupyter.
- Bad: an exported .ipynb shows a ready-made step as a commented call; it runs outside sprisk only with the plugin packages installed.
- Bad: old notebooks need a one-time conversion into their flow.

## Delivery
1. Contracts: `Node.stage`, `Node.notes`, `Node.names`. Python reads code cells into steps.
2. `sprisk.code.python@3.0.0`: ports of any kind, and `setup`.
3. A run that targets one step, reusing the steps above it.
4. Web: notebooks drawn from the flow, form cells, automatic saving, run cell runs the step. Retire the sync code.
5. Convert old notebooks.

## Validation
- Python: a name set twice, or changed in place, is refused naming both cells; a name no cell above sets is refused; imports used are copied into `setup`.
- Web: a flow becomes one notebook per stage; a form edit in a cell is a new version the canvas shows; deleting a step removes its cell.
- Scheduler: a targeted run reuses unchanged steps above, runs changed or never-run ones, and leaves steps below untouched.
- Browser: build the German credit flow in notebooks, run it cell by cell, see the same results on the canvas, change a setting there and see the cell change.
