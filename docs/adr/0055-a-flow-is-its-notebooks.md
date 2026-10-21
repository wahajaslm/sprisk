# ADR-0055: A flow is its notebooks: one notebook per stage, one cell per step
Status: Accepted
Date: 2026-10-21
Arch doc sections: §2A (Notebook views), §4 (domain model), §9 (runs). Supersedes ADR-0037 and ADR-0054. Changes ADR-0031 (one cell is one step), ADR-0033 and ADR-0036 (one kernel per flow).

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
- `Node.stage` places a step in a stage. Absent: the stage its operator implies, as today.
- `Node.notes` holds the Markdown cells shown before the step (`before`) and, for the last step of a stage, after it (`after`).
- Cell order is the order of `nodes`, by stage. A cell reads only names set by cells above it or in earlier stages.
- New flow notebooks are no longer `NotebookVersion`s. Old ones stay readable (rule 5).

**Sync is automatic, because there is nothing to sync.**
- Editing a cell saves a new flow version when the person runs the cell or leaves it, and only if its code changed. No Save button, no "Sync from flow".
- Every canvas edit (add a step, change a setting, delete a step) is a new flow version, and the notebook shows it at once.

**A ready-made step is one plain call.**
- `from sprisk import random_split` then `train, test = random_split(data, test_fraction=0.2, seed=0)`.
- `sprisk` is the public Python package. A name in it is an operator's entrypoint function, which must be unique across installed operators. It calls the same code, with the same checks, as the worker (rule 4). Internal module paths never show.
- Inputs are positional, in the card's order. Outputs are unpacked in the card's order. Settings are keywords with plain values (numbers, text, lists, true/false).
- `Node.names` keeps the variable each output goes by (`{"train": "train", "test": "test"}`), so other cells can read it.
- Python reads the call back exactly with `ast` (rule 2). A cell that uses a `sprisk` function in any other shape is refused with a message saying how to write it. A setting that is not a plain value is refused. Nothing is guessed.
- Changing a value in the form rewrites the call. Changing it in the call changes the step's settings.
- A ready-made step whose code was edited (ADR-0028) is the function's code and then the call, in one cell.

**Every other cell is a code step, read by Python.**
- One cell is one step. Cells are never merged.
- Each name is set by one cell. A second cell setting it, or changing it in place (`df["x"] = ...`), is refused with both cell numbers. The person writes a new name (`df2 = ...`).
- Arrows come from names: a cell that reads a name another cell set is linked to it.
- A value passed between cells may be a table, a model, or plain data (numbers, text, lists, dicts). A new code operator, `sprisk.code.python@3.0.0`, has ports of any of these kinds. The worker stores each by what it is. Anything else (an open file, a generator) fails the step, naming the value.
- Imports, constants and functions are not passed. Each step gets a copy of the ones it uses from the cells above, in its own `setup` setting. Its source stays exactly as the cell shows it.

**Running.**
- Running a cell is a quick try on the flow's kernel, as in Jupyter. Its output is scratch (ADR-0036).
- One kernel per flow, shared by its stage notebooks, so names from the Split notebook are there in the Model notebook.
- Run flow is the record: every step runs in order through the scheduler, with checks and history. Unchanged ready-made steps reuse results (ADR-0026).

## Alternatives considered
- **Keep two copies and sync them better.** Rejected: matching by text is the cause of the drift, and better matching is still matching.
- **The notebook is the record; the flow is drawn from it.** Rejected: the scheduler, caching, Gate B and AI proposals work on typed steps (§9, rule 3). A notebook run top to bottom has none of that.
- **Raw scikit-learn calls as ready-made steps.** Rejected: a step like `impute` is safe by design (it learns only from train). Raw calls lose that, and a card cannot describe a fit-then-transform pattern.
- **Running a cell runs the step through the scheduler.** Rejected for now: there is no single-step run (ADR-0026), and code steps never reuse results, so each cell run would rerun every code step.
- **Merge cells that share a non-table value (ADR-0031).** Rejected: a person can no longer tell which cell is which step.

## Consequences (good and bad)
- Good: the notebook, the canvas and the form can never disagree.
- Good: a notebook reads as plain Python. The only sprisk thing in it is `from sprisk import ...`.
- Good: removes the sync code, the cell markers and the per-notebook copies of steps.
- Bad: stricter than Jupyter. One cell per name, and no in-place change to another cell's value.
- Bad: a cell run is scratch. The flow's results come from Run flow.
- Bad: `sprisk` names are the functions' own names (`impute`, `random_split`). Friendlier names would need a field on the card.
- Bad: old notebooks need a one-time conversion into their flow.

## Delivery
1. Contracts: `Node.stage`, `Node.notes`, `Node.names`. The `sprisk` package. Python reads cells into steps and calls.
2. `sprisk.code.python@3.0.0`: ports of any kind, and `setup`.
3. Web: notebooks drawn from the flow, automatic saving, form and call kept as one. Retire the sync code.
4. One kernel per flow.
5. Convert old notebooks.

## Validation
- Python: a call is read exactly; every refused shape names the cell and says what to write; a name set twice, or changed in place, is refused; imports used are copied into `setup`.
- Web: a flow becomes one notebook per stage and back with no change; a form edit rewrites the call; deleting a step removes its cell; editing a call changes the setting.
- Browser: build the German credit flow in notebooks, run it, see the same flow on the canvas, change a setting there and see the cell change.
