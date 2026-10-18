# ADR-0031: Code steps link by variable name
Status: Accepted; importing a notebook now makes a notebook, not a flow (ADR-0036). The analyzer stays.
Date: 2026-10-16
Arch doc sections: §5 (typed pipeline IR), §9 (runs, caching), §11 (contracts). Builds on ADR-0020, 0021, 0026, 0030. Node Framework spec §5, §8.3, Scenario A.

## Context
- Users bring ordinary notebook cells: A defines `df`, B reads `df` and defines `filtered`, C reads `filtered`.
- Today a code step has one fixed input (`data`) and one table output. Cells must be rewritten to fit.
- marimo shows that dependencies can be read from the code: what a cell defines and what it reads.
- marimo's rules belong to its notebook runtime (one shared namespace, one definition per name). sprisk steps run isolated, in workers, from artifacts.

## Decision
- **A code step's ports are its variable names.** New operator `sprisk.code.python@2.0.0`. Its params list `inputs` and `outputs` by name. A params-schema marker (`x-sprisk-ports: input | output`) tells the Rust compiler to add them as table ports, so edges, kinds, caching and history work as for any step.
- **Splitting cells is Python, never running them.** `POST /code/split` takes cells and returns steps and links. The API starts a short Python process (`python -m sprisk_code.cells`, 10 s limit, at most 2 at once, at most 1000 cells) that only parses the code with stdlib `ast` and `symtable` (rule 2). Nothing is executed; the process is the boundary for hostile input.
- **Reading a cell, in notebook order:**
  - a name a cell reads before it sets it comes from the latest earlier cell that sets it;
  - an import is copied into the cell that uses it (`import pandas as pd`);
  - a top-level number, text or boolean is copied too (`min_age = 18`), so it can be exposed as a setting there;
  - a function, a class, a list/dict/set/tuple literal, or a name that is not a valid port name (`X_train`, `console`) keeps the cells from definer to user together in one step;
  - a cell that changes a table in place (`df["a"] = 1`, `inplace=True`) passes the changed table on; `del` ends a name;
  - anything else becomes a link: an output on the earlier step, an input on the later one.
- **The person confirms, then runs.** The UI shows the steps, links, notes and each step's code before it creates the flow. Creating does not run it: the notebook may be someone else's, so the person presses Run graph. Links are ordinary edges in the `PipelineVersion`. Nothing is resolved by name at run time (rule 5).
- **Tables cross steps; they keep their library.** A polars or pandas DataFrame crosses as Parquet. A code step gets each input table back as the library that wrote it (pandas metadata in the file). Built-in steps always get polars.
- **Any other value fails the step clearly**: the message names the variable, its type and the fix (keep those cells in one step).
- **Notebook files.** `.ipynb` code cells and the `# %%` cell format are read in the browser (plain JSON and text) and sent as cells. IPython magics (`%`, `!`) become comments.
- **Effects: side_effecting**, like every code step: a notebook cell may write files or call services, so it is never retried or reused automatically (arch §9).
- **No marimo dependency.** Its analyzer is tied to its runtime. marimo's scoping cases (comprehensions, functions, `global`, `del`) are our test cases.
- **Later, each with its own change:** models and JSON values crossing steps (kind from a first run), in-place changes the analyzer cannot see (`lst.append`), session mode (Node Framework §8.3).

## First slice
- Paste three cells, or open a notebook. sprisk shows three steps, two links and their code; Create flow.
- Run graph, explore each step's variables (ADR-0030), expose one setting and edit it.

## Alternatives considered
- **Adopt marimo as the runtime.** Rejected: one shared namespace cannot be scheduled, cached or retried per step.
- **Resolve names at run time from a global namespace.** Rejected: the run would depend on hidden state, not on the saved graph.
- **Keep one `data` input.** Rejected: every multi-input cell must be rewritten.

## Consequences (good and bad)
- Good: notebook cells move into sprisk with no rewriting and no sprisk imports.
- Good: every link is visible, versioned and checked by methodology rules like any edge.
- Bad: compiler change: a code step's ports come from params, not only the manifest.
- Bad: only tables cross steps in this slice. Other values make the step fail with a clear message.
- Bad: a new API → Python call (a short process). Bounded by a time limit and input size.
- Bad: pandas becomes a dependency of the code pack: notebooks use it.

## Validation
- Analyzer tests: defines/reads for assignments, augmented assignment, comprehensions, functions, `global`, `del`, imports.
- Compiler tests: ports from params; an edge to an undeclared name is `not_an_input`.
- Worker tests: tables in and out by name; pandas stays pandas; a non-table output fails with its name and type.
- API test: `POST /code/split` returns steps and links; a slow or broken analyzer is an error, not a hang.
- End-to-end: the first slice above, on the penguins flow.
