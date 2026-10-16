# ADR-0022: Operators are plain Python functions; the worker does the plumbing
Status: Accepted
Date: 2026-10-16
Arch doc sections: §7 (operators), §9 (operator manifest), §11 (worker protocol)

## Context
- Every step's Code tab now shows its real source (OperatorSource).
- That source is mostly plumbing: read Parquet paths, write files into a staging dir, build `Output` records, raise `OperatorError`.
- A data scientist reading a step should see Polars and scikit-learn code, not sprisk internals.
- The same plumbing is copied into every plugin (`read_pair`, `write_split`, `read_table`, skops loading).

## Decision
- An operator is a plain function. Its keyword arguments are its input ports and its params, by name.
- Inputs arrive typed by port kind:
  - `table` → `polars.DataFrame`.
  - `model` → fitted scikit-learn estimator, loaded with skops and a trusted-type list.
  - `metrics`, `diagnostics`, `report` → the parsed JSON value.
- It returns the value of its only output, or a dict keyed by port name when it has several.
- The worker writes each value by port kind: DataFrame → Parquet, estimator → skops, JSON value → JSON.
- The worker turns errors into failures:
  - `ValueError` → permanent failure `invalid_input` with its message.
  - Polars column errors → permanent failure `missing_column`.
  - Anything else → permanent failure `operator_error` with type and message.
- Operator code imports no sprisk module. It may use Polars, NumPy, scikit-learn, SciPy and statsmodels.
- The code step (ADR-0020) uses the same calling style: it returns `data`, `display` and `interface`.
  Its own module is the worker's runner for the user's code, so it may import sprisk (the display
  contract, AST discovery, the code-error type). Its Code tab shows the user's code, never this module.

## Alternatives considered
- **Hide plumbing in the UI** (show only the function body). Rejected: the shown code would not be the code that runs.
- **A sprisk base class per operator.** Rejected: still sprisk-specific, more ceremony, nothing gained.
- **Two calling conventions behind a manifest flag.** Rejected: two ways to do one thing.

## Consequences (good and bad)
- Good: steps read like normal data-science code; plugins shrink; plumbing is written and tested once.
- Good: output files can only be written by the worker, inside staging. The `output_outside_staging` check becomes impossible to trip.
- Good: untrusted model loading lives in one place.
- Bad: every existing operator is rewritten once.
- Bad: an operator cannot stream a huge output in pieces. Not needed today; revisit with a streaming port kind if it is.

## Validation
- Every plugin's source has no `sprisk_` import (a test checks this).
- All plugin and end-to-end pipeline tests pass unchanged in behaviour.
- The Code tab of any built-in step reads as plain Polars / scikit-learn.
