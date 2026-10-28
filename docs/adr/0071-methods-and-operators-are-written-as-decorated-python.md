# ADR-0071: Methods and operators are written as decorated Python
Status: Accepted
Date: 2026-10-28
Arch doc sections: §8 (methodology), §14 (layout), §15.1 (a capability is a plugin package). Narrows ADR-0063 (file format) and ADR-0055 (notebook code). Keeps ADR-0062 §3.

## Context
- One operator today is five pieces: `manifest.yaml`, `params_schema`, a `run` function, a hand-written `as_code`, and evidence manifests. One method is `method.yaml` plus `method.py`.
- Settings are written twice: in `params_schema` and in the function signature.
- Every `as_code` copies its operator's logic by hand.
- People cannot read a step as one piece of code.
- The spike on `spike/decorator-split` (0ce030f7) rewrote the split this way. 28 tests show the same choices, the same rows, the same verdicts and the same YAML as today, with the listed differences.

## Decision
**Python is the authoring format.**
- **A method is one file.** It has `@method(...)`, a function with plain parameters, and `method.choose(...)` / `method.ask(...)`.
  - Options are `option("Keep each item's rows on one side", group_split)`. The label is the methodological choice; the operator is how it is done.
- **An operator is one file.** It has `@operator(...)`, its `@promise`s and its visualizations.
  - A promise returns a `Verdict(status, detail, evidence)`. The evidence is named and stored against the option it verifies.
  - A visualization is marked `@visualization`, or found by AST because it returns `go.Figure` or `alt.Chart`.
- **Concepts stay first class.** `@concept` defines a new one. `columns=` is the short form of `concepts=` for one bound to a table column. Bindings stay per project.

**The method never sees a column name (ADR-0063).**
- A parameter for a concept gets a `Binding` when the concept is bound, else `None`. A `Binding` is truthy and has no column name. It carries the binding's assurance once the method request sends it.
- A reason may say `{item_identity}`. It is filled with the column name only when shown.
- A ruled-out option arrives as a `ruled_out` parameter, as `ctx.ruled_out` does today.

**A build compiles the files.**
- `just build-packs` writes the versioned Method IR. Its serialization today is the existing `method.yaml` and `manifest.yaml` contracts, so Rust is unchanged.
- `just check` fails when the IR is stale.
- The notebook cell is the operator's own function plus one call line. It replaces `as_code`.
- A decision record keeps the method's inputs and a hash of its code.

**Ownership is unchanged (rule 2).** Rust loads, checks, places, schedules and records. Python runs methods, operators, promises and visualizations.

## Alternatives considered
- **Keep YAML, `method.py` and manifests.** Rejected: five pieces per operator, and `as_code` duplicates logic.
- **Compile the method's `if`/`else` into Rust rules.** Rejected: a second language (ADR-0042, ADR-0063).
- **One file per node, with its operators inside.** Rejected: operators are shared, e.g. `random_split` serves two options.
- **Find everything by AST, no decorators.** Rejected: role, folds and promises are not in the code.
- **A `ctx` object for the method.** Rejected: plain parameters read better.

## Consequences (good and bad)
- Good: a step reads as one Python file, and the notebook shows that same code.
- Good: settings and logic are written once.
- Good: a plot belongs to its operator and shows on its node.
- Bad: the build imports Python to read the decorators. Only first-party packs are built this way; a third-party pack ships its IR.
- Bad: until Rust runs promises on outputs directly, the build also writes evidence steps and `verify_*` plumbing. That needs a contract change, in a later ADR.
- Bad: two formats live side by side until the last method is converted.

## Delivery slices
1. SDK in `sprisk-workers`, `just build-packs`, stale check, notebook cell from source.
2. Convert the split. The existing split tests and the Rakuten walk test pass unchanged.
3. Each operator's visualizations become a `figures` output, shown on its node.
4. Remove the split example view.

## Validation
- The Rakuten walk test makes the same split decision, with the same promises, as before.
- A changed operator file without a rebuild fails `just check`.
- A person can read the Split step as one file and recognise it in the notebook.
