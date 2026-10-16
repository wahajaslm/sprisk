# ADR-0031: Code steps link by variable name
Status: Proposed
Date: 2026-10-16
Arch doc sections: §5 (typed pipeline IR), §9 (runs, caching), §11 (contracts). Builds on ADR-0020, 0021, 0026, 0030. Node Framework spec §5, §8.3, Scenario A.

## Context
- Users bring ordinary notebook cells: A defines `df`, B reads `df` and defines `filtered`, C reads `filtered`.
- Today a code step has one fixed input (`data`) and one table output. Cells must be rewritten to fit.
- marimo shows that dependencies can be read from the code: what a cell defines and what it reads.
- marimo's rules belong to its notebook runtime (one shared namespace, one definition per name). sprisk steps run isolated, in workers, from artifacts.

## Decision
- **A code step's ports are its variable names.** Inputs: names it reads that no line in it defines. Outputs: names it defines that another step reads. Stored in the node's params; the Rust compiler reads them as the step's ports (new operator version `sprisk.code.python@2`).
- **The analyzer suggests; the person confirms.** The worker's discovery (stdlib `ast`, rule 2) proposes edges `A.df → B.df` as `inferred`. Confirmed edges are ordinary edges in the `PipelineVersion`. Nothing is resolved by name at run time. The graph on screen is the graph that runs (rule 5).
- **Only saveable values cross a step.** A table, model, figure or JSON value crosses as an artifact (ADR-0022 port kinds). Anything else (an open file, a custom object) cannot be an output; the analyzer says why.
- **Conflicts are not guessed.** A name defined by two upstream steps is ambiguous: the person picks one, or the compile fails (`ambiguous_input`).
- **Mutation is safe but flagged.** Each step loads its own copy of its inputs, so `df.dropna(inplace=True)` cannot change another step's data. A step that mutates an input but does not output it gets a Checks warning: the change stops at that step.
- **Invalidation is ADR-0026.** An edit runs from the edited step onwards; unchanged upstream steps are reused.
- **No marimo dependency.** Its analyzer is tied to its runtime. We use marimo's documented scoping rules (comprehensions, `global`, `del`, function bodies) as test cases for our own analyzer.
- **Session mode stays out.** A shared live kernel (Node Framework §8.3) needs its own ADR.

## First slice
- Paste three cells. sprisk makes three code steps and suggests two edges.
- Confirm, run, explore each step's variables (ADR-0030), expose one parameter, edit it: only that step and the steps after it run.

## Alternatives considered
- **Adopt marimo as the runtime.** Rejected: one shared namespace cannot be scheduled, cached or retried per step.
- **Resolve names at run time from a global namespace.** Rejected: the run would depend on hidden state, not on the saved graph.
- **Keep one `data` input.** Rejected: every multi-input cell must be rewritten.

## Consequences (good and bad)
- Good: notebook cells move into sprisk with no rewriting and no sprisk imports.
- Good: every link is visible, versioned and checked by methodology rules like any edge.
- Bad: compiler change: a code step's ports come from params, not only the manifest.
- Bad: values that cannot be saved cannot cross a step. Users must keep that work inside one step.

## Validation
- Analyzer tests: defines/reads for assignments, augmented assignment, comprehensions, functions, `global`, `del`, imports.
- Compiler tests: ports from params; `ambiguous_input`; an unsaveable output is rejected.
- End-to-end: the first slice above, on the penguins flow.
