# ADR-0018: Studio cockpit is the workbench's default layout and workflow

Status: Accepted
Date: 2026-10-16
Arch doc sections: §2A, §4, §5, §8, §16

## Context

- `docs/design/sprisk-studio.html` is the usability basis. Screens: `docs/design/screens/{flow,datasets,notebooks,experiments,deploy}.png`.
- §2A keeps it as an interaction reference and replaces its fixed panels with docking.
- In Studio, methodology is not a separate gate page. Each judgment call is a **decision node** with options, a recommended choice, a parameter, evidence and checks.
- Studio cleans data before the split and relies on warnings to catch leakage. Our engine must make that leak impossible instead.
- M2 (AI-created pipeline) was next. We want a usable view of real runs first.

## Decision

### 1. Layout: the cockpit is the default dock layout

| Region | Content |
| --- | --- |
| Top bar, left to right | **Project / flow switcher first**, then nav: Flow, Datasets, Notebooks, Experiments, Deploy. Right: run state ("Graph up to date", "N steps queued") and **Run graph**. |
| Left | Per view: Flow has the step library (search, steps grouped by stage, kind icon, hint such as "Decision"); Notebooks has the notebook list. |
| Centre | The view's main surface. Flow: canvas with stage frames left to right, live one-line result per node, zoom/Fit, kind legend; below it the **inspector** (tabs Decision · Code · Data · Logs). |
| Right | **Copilot**: context chip, explanation, "Decision points · N" card, suggestion chips, input. |

The only change from the concept: the project/flow switcher moves to the far left of the top bar.
Regions are docks (dockview behind `dock-adapter`); first open looks exactly like the concept. Users may rearrange; layout is UI preference only (§2A).

### 2. Views

| View | Shows | Engine source |
| --- | --- | --- |
| Flow | Stages, nodes, status, inspector | `PipelineVersion`, latest `Run` attempts, outputs |
| Datasets | Datasets with origin, rows, cols, quality, version, used-by; column profile with type, missing, distinct, shape, role in the flow | `summarize` artifacts, lineage |
| Notebooks | Cells; "Add to Flow · <stage>" | Later; execution only through workers |
| Experiments | Every run with one column per decision, metrics, `leak` flag; decision diff; metrics; accuracy vs features | Runs, `ParamChoice`, `MethodologyCheck`, metrics artifacts |
| Deploy | Production/staging, canary, latency, drift | Later (decision release) |

### 3. Methodology is shown where the decision is

- Decision tab: question, options with one **recommended**, parameter, evidence chart, checks (✓ / warning / leak), rationale.
- Copilot "Decision points" card lists every decision and its current value.
- Experiments flags runs whose checks found leakage.
- Rules return a **check and a recommendation**. The recommendation is a `ParamChoice` (ADR-0016, now Accepted).

### 4. Cleaning is fit on train, by construction

Transforms that learn from data (impute, scale, clip outliers) take `train` and `test`, fit on `train` only, and apply to both. Constant transforms (drop columns, fill 0) may run before the split. `split_leakage` fails any fitting transform upstream of a split.

### 5. Order of work

A thin cockpit over today's engine comes before M2: shell, top bar, step library, canvas, inspector (Data, Logs, checks). Copilot and the full Decision tab render as placeholders until `ParamChoice` and the planner exist.

## Alternatives considered

- Separate "methodology gate" page. Rejected: Studio places judgment at the decision, where the user acts.
- Keep Studio's fixed CSS grid. Rejected by §2A: docking is required.
- Warn about pre-split fitting, as Studio does. Rejected: a warning can be ignored; the operator shape cannot.
- Build M2 first. Rejected for now: the Copilot needs a surface to propose into.

## Consequences

- Good: one interaction model for users, rules and the AI.
- Good: leakage from cleaning cannot be expressed in a valid pipeline.
- Bad: two-input fitting transforms make graphs wider than Studio's.
- Bad: milestone order changes; M2 starts after the cockpit shell.

## Validation

- First open of the web app matches `screens/flow.png` region for region, with the switcher on the left.
- The §2A docking proof-of-concept gate passes.
- A pipeline with a fitting transform before the split fails Gate B.

## Arch doc edits needed

- §2A: name the five views and the default cockpit layout; link `docs/design/screens/`.
- §5: fitting transforms take train and test.
- §16: note the cockpit shell before M2.
