# ADR-0030: Data explores variables; Visualizations shows displays and builds charts
Status: Accepted; the chart builder is superseded by ADR-0032
Date: 2026-10-16
Arch doc sections: §2A (Inspector, data locality), §11 (contracts). Amends the Data and Visualizations rows of ADR-0025. Builds on ADR-0021, 0024, 0027.

## Context
- The Inspector has nine tabs: Code, Data, Visualizations, Console, Inputs, Parameters, Checks, Performance, History.
- ADR-0025 defines Data as "every table or value produced". That treats Data as a list of outputs.
- People coming from Jupyter, marimo or Spyder expect Data to be a variable explorer: pick a variable, see its columns, types, missing values, sample rows.
- Code steps already list their variables (`CodeInterface.outputs`: name, type, shape). Only the chosen one can be explored.
- Adding a chart from a table lives in the Data tab today (`ChartMenu`). People look for it in Visualizations.

## Decision
- **The nine tabs and their names stay.** No renames, no new tabs.
- **Data is a variable explorer.** It lists every value the step holds after it runs, not only its output ports:
  - built-in steps: their returned values, as today;
  - code steps: every top-level variable in `CodeInterface.outputs`.
- **Exploring a variable is worker work.** The code step's `interface` report carries, per variable (rule 9, arch §2A data locality):
  - tables (DataFrame, Series): fields with type and missing count (first 500), and the first 10 rows;
  - other values: a bounded repr (2,000 characters).
  - Fields and samples share one 768 KB budget per report; a variable past it keeps its fields but no rows, and the UI says so.
- **Visualizations has two parts in one workspace:**
  - the figures and rich displays the step's code produced, in order, labelled by origin (ADR-0024);
  - a chart builder: pick a chart and columns of a table the step passes on, get a figure. To chart another variable, pass it on first (Data tab).
- **The chart builder adds a chart step.** It does not draw from data in the browser. Python draws it, as for every figure (ADR-0024). It is a new `PipelineVersion` and runs like any edit (ADR-0026). The user's code is never changed unless they ask to insert equivalent code.
- **Checks, Performance and History are sprisk services.** No step implements them.
- **An opaque step (future external program) shows empty states** for tabs it cannot fill. Nothing is invented.
- Arch doc §2A: add a line under Workbench object model naming the nine tabs and pointing to ADR-0025 and this ADR.

## Alternatives considered
- **Keep Data as outputs only.** Rejected: hides the values people most want to check in exploratory code.
- **Chart builder draws in the browser.** Rejected: second drawing system (ADR-0024) and the browser would need the rows (rule 9).
- **Split Visualizations into Figures and Chart builder.** Rejected: one workspace is what people expect.

## Consequences (good and bad)
- Good: the Inspector matches notebook habits; a user can check any variable without editing code.
- Good: charts made in the builder are versioned, cached and in history.
- Bad: a code step's `interface` report grows, up to about 800 KB for many large tables.
- Bad: a variable not passed on can only be explored, not wired to another step. Wiring by variable name is a separate ADR (marimo-style cross-step dependencies).

## Validation
- Worker test: a code step with three DataFrame variables writes three capped summaries; a large frame is capped.
- Browser test: Data lists every variable; selecting one shows columns and sample rows; no full table is fetched.
- Browser test: the Data tab has no chart button; the chart builder in Visualizations adds a chart step, for built-in and code steps.
