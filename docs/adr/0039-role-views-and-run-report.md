# ADR-0039: One flow, a view per role, and a run report
Status: Proposed
Date: 2026-10-18
Arch doc sections: §2A (Workbench object model), §4 (domain model), §8 (Gate C/D), §9 (runs). Builds on ADR-0030, ADR-0036, ADR-0037.

## Context
- Analysts, data scientists, ML engineers and reviewers all work on the same flow, but need different things from it.
- Other tools fix this by giving everyone one interface (Netflix: notebooks) or by splitting the work across products (cloud suites). Both make people copy work between tools.
- sprisk already has one record (`PipelineVersion`, `Run`, `Attempt`, `Artifact`, `MethodologyCheck`) and several views of it: Data, Visualizations, Notebook, Flow canvas.
- What's missing: a view for reviewers. No place shows a finished run as one readable document with its evidence and checks.

## Decision
- **Role presets pick the starting view and layout.** They are `WorkspaceLayout` defaults, not permissions (rule 9):

  | Role | Starts in |
  | --- | --- |
  | Analyst | Data and Visualizations |
  | Data scientist | Notebook |
  | ML engineer | Flow canvas + Inspector |
  | Reviewer | Run report |

  Anyone can open any view. The preset is a per-user preference.
- **New view type `run-report`.** It shows one `Run` as a read-only notebook:
  - One section per step, in graph order: the step's code, then its outputs and figures from its `Artifact`s.
  - A badge on each step: Attempt id, cached or fresh, input artifact hashes, duration.
  - The run's `MethodologyCheck`s shown on the steps they cite (`cited_nodes`). Checks citing no node show at the top.
  - Failed Attempts show their error and an **Open in notebook** action.
- **The report is built from existing records.** No new entity and no stored copy. Opening it starts no kernel.
- **Open in notebook** opens the step's notebook (ADR-0037) at the cells it came from. Loading the failed Attempt's exact inputs into the session comes later, with its own change.
- **Export:** the report can be saved as `.ipynb` with outputs, for sharing outside sprisk.

## Alternatives considered
- **Store an output notebook per run (papermill style).** Rejected: a second copy of what Attempts and Artifacts already hold, and it could drift from them (rule 5).
- **Role-based permissions now.** Rejected: local-first has one user. Permissions come with hosted mode (§13).
- **Reviewers use the Flow canvas.** Rejected: the canvas shows structure, not the story of a run.

## Consequences (good and bad)
- Good: every role works on the same record. Nothing is copied.
- Good: reviewers get one page that shows what ran, on which data, and what the checks said.
- Bad: a large run makes a long report. Sections load lazily and outputs stay bounded (ADR-0029).
- Bad: built-in steps have no code to show; their section shows the operator id and settings instead.
- Bad: the Attempt does not yet record its environment digest (§8), so the badge cannot show it.

## Validation
- Tests: report sections follow graph order; a check shows on the step it cites; a cached step shows the Attempt that made its artifact; a failed step shows its error and Open in notebook.
- Browser: run a flow with a leak, open the run report, see the FAIL on the leaking step, open it in the notebook.

## Arch doc edits
- §2A `ViewType` list: add `run-report`.
- §2A `WorkspaceLayout`: add role presets as layout defaults.
