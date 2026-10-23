# Hidden methodology: problem statement

Status: Problem accepted. Solutions are candidates only and need ADR review.
Date: 2026-10-23.
Architecture: enterprise v2 §4, §8, §9, §11 and §14. Related: ADR-0042, ADR-0055, ADR-0057, ADR-0059, ADR-0060.

## 1. Introduction

sprisk is meant to do data science automatically and correctly. You give it a question and data. It builds the analysis step by step, and a methodology rule decides each step. What sets it apart from AutoML is that every choice has a visible reason, evidence and a source.

Today those reasons are not visible. The rules work, but users cannot see them and developers cannot easily find them.

## 2. Background

### 2.1 Building blocks

| Block | What it is | Example |
| --- | --- | --- |
| **Flow** (`PipelineVersion`) | A directed acyclic graph of steps with typed ports. Each change makes a new, immutable version. | Load → Split → Model → Evaluate |
| **Operator (node)** | One step that does work | Drop duplicates: `df.unique(keep="first")` |
| **Rule** | A pure function that decides which steps exist and how they are set | "If 5% or fewer rows repeat, add Drop duplicates" |
| **Decision** (`MethodologyDecision`) | The immutable record of one applied rule choice | rule, alternative, reason, evidence, who |
| **Check** (Gate B) | Verifies a result after it runs | "No row is in both train and test" |

Rules make traceable, evidence-based decisions under explicit assumptions, with validation and human review where required. They do not make universally correct choices. For example, the 5% duplicates bar is a project convention (`exact_duplicates/rule.yaml`), not a published threshold.

### 2.2 System layers

| Layer | Language | Job |
| --- | --- | --- |
| Contracts (`contracts/`) | JSON Schema | Defines every shared type once. Rust, Python and TS types are generated from it. |
| Control plane (`crates/`) | Rust | Owns the flow: builds versions, compiles them, schedules runs, applies decisions, runs checks, keeps history. |
| Workers (`python/`, `plugins/`, `methodology/`) | Python | Does the science: runs operators, profiles data, runs rule `decide()`, writes notebook code. |
| Web app (`apps/web/`) | React + TS | Presentation only. |

Rust decides what is allowed and in what order. Python decides what is scientifically appropriate.

### 2.3 What happens when a rule fires

1. Rust gathers facts: question answers and the data profile ("1000 rows, 12 duplicates").
2. Rust starts a bounded Python process: `python -m sprisk_workers.rule rule.py`.
3. Python `decide()` returns alternatives, each with a status and reason, and a recommendation.
4. Rust turns the chosen alternative into a typed effect: `insert_node`, `replace_node` or `remove_node`.
5. Rust builds a new flow version and compiles it.
6. Rust records a `MethodologyDecision`. The changed node gets `methodology_decision_id`.
7. Rust schedules the run. Python workers run each operator.
8. Rust runs Gate B checks on the results.
9. Python writes each step's notebook cell from its settings (`notebook_code`).
10. The web app shows the flow, the cells and the results.

The engine (`POST /walks`, ADR-0060) repeats steps 1 to 8 by itself and stops when it is done or needs a person.

### 2.4 Where the pieces live

```
contracts/                          shared types
crates/sprisk-methodology/          rule catalog, review, effects, engine
crates/sprisk-api/                  API, runs rules in Python, applies decisions
crates/sprisk-scheduler/            runs flows, Gate B checks
plugins/<area>/operators/<op>/      operator manifest
plugins/<area>/src/                 operator code
methodology/<pack>/rules/<rule>/    rule.yaml and rule.py
apps/web/                           UI
```

## 3. The problem

The rules are separated from the nodes they shape in the files, in the data passed between layers, and on screen. So the most valuable part of sprisk is invisible.

### 3.1 Users cannot see why a step exists

- A cell shows `df.unique(keep="first")` but not "12 rows repeat, so they were dropped."
- The reasons sit in an inspector panel most users never open. An exported notebook loses them.
- Cause: Apply sets only the node's operator, params and `methodology_decision_id`. The notebook writer receives settings and variable names, never the decision. The web notebook never resolves `methodology_decision_id`.

### 3.2 Users cannot tell checked code from unchecked code

- A system-made cell and a hand-typed cell look the same.
- Cause: the only difference is the operator id (`sprisk.clean.drop_duplicates` or `sprisk.code.python`). Rust matches rules to nodes by that id (`crates/sprisk-methodology/src/catalog.rs`). The notebook does not show it.

### 3.3 Editing a cell silently drops protection

- A value-only edit (`200` to `500`) is read back as a setting. The rules still apply.
- Any other edit makes the node `sprisk.code.python`. No rule lists that operator.
- The edit also drops the node's `methodology_decision_id` (`asCodeSteps`, `apps/web/src/notebook/stageCells.ts`), so the decision behind the step is lost.
- Checks are chosen by operator. The scheduler runs the split check only on nodes whose operator is a split (`crates/sprisk-scheduler/src/run.rs`, `check_splits`).
- A split cell is protected: the API refuses to turn it into code (`split_is_not_code`). Any other ready-made step loses its rules and checks without warning. This is a verification coverage failure, not only a display problem.

### 3.4 Developers cannot find the rules for a node

Drop duplicates is spread over three places:

- `plugins/clean/operators/drop_duplicates/manifest.yaml`, the node
- `plugins/clean/src/sprisk_clean/columns.py`, its code, shared with other operators
- `methodology/common/rules/exact_duplicates/`, the rule that adds it

The rule sits on the Split node (`applies_to: random_split`), not on Drop duplicates. Nothing in the operator's folder points to it.

### 3.5 Rules run only when someone asks

- Saving a flow in the app runs no rules.
- A person opens the inspector, clicks "Review", then "Apply".
- The engine automates this, but the web app never calls it, and branch `engine/core` is not on `main`.

### 3.6 A bug misreports rules on split steps

- On a split node, every rule panel calls `useResolveSplit`. That posts to `/methodology/split/{node}/proposals`, which always resolves `split.method` (`apps/web/src/api/methodology.ts:9`).
- So all 8 rules on a random split show the `data_split` proposal instead of their own.
- The other 7 can be seen only on the Methodology page, which has no Apply.

### 3.7 Users cannot control the decision from the code

- The notebook is where users work, but a rule's logic, evidence, thresholds and override are not in the cell.
- Reading the logic is not possible. Seeing the reason, changing a threshold, or picking another alternative is possible only in the inspector panel.

| Ability | Today |
| --- | --- |
| Read the decision logic | Not possible |
| See why an alternative was chosen | Inspector panel |
| Change a threshold | Rule settings, not in the cell |
| Override the choice | Inspector panel: pick, reason, Apply |
| Rewrite the logic | Not possible |

Settled direction (2026-10-23): users read, tune and override in the cell. The cell shows the rule's logic summary and evidence, and exposes the rule's settings and the choice as plain lines:

```python
# Decision: feature scaling (rule feature_scaling, reviewed)
# Logic: trees -> none; any kurtosis > threshold -> robust; else standard
# Found: income kurtosis 7.2, age 1.1 -> robust
threshold = 3      # a rule setting
choice = "auto"    # or "robust", "standard", "none"; a reason is recorded
```

Rewriting a rule's logic is out of scope. An edited rule loses its review, its upgrades and the guarantee that the same data gives the same flow. It is revisited only when users ask for it, and then only with a visible "not reviewed" mark.

## 4. Why it matters

- **Trust:** users cannot check the reasoning.
- **Differentiation:** without visible reasons, sprisk looks like AutoML.
- **Safety:** users edit code without knowing they lost protection.
- **Maintenance:** developers cannot see which rules shape which node.

## 5. Principle

Methodology is a first-class, versioned execution concern. It is not metadata attached to Python code.

- Decisions have identity, evidence, assumptions, versions and provenance.
- Operators implement transformations. Methodology decides when they are appropriate.
- Validation checks outcomes and declared obligations independently of who wrote the code.
- A code edit triggers verification reassessment. It never silently drops protection.
- The UI and exported notebooks show the same authoritative decision history.

## 6. Candidate solutions requiring ADR review

### 6.1 Rejected candidates

| Candidate | Why not |
| --- | --- |
| Each operator owns its rule, with `needed()` next to `run()` | A rule can span several operators and stages. A duplicate-entity leakage rule touches duplicate handling, group construction, splitting and evaluation. No one operator owns it. A boolean `needed()` also cannot express alternatives, uncertainty, prerequisites or approval. |
| Copy the decision's reason onto every node | It duplicates the authoritative `MethodologyDecision`, and the copies can drift. The node already links to it by `methodology_decision_id`. |
| Keep checks after any code edit as if nothing changed | A check can still run, but a pass no longer proves the original assumptions. Edited code keeps its check obligations, not the verified status. |

### 6.2 Candidates

| Area | Candidate | Layers |
| --- | --- | --- |
| Rule location | Keep `methodology/<pack>/rules/` as an independent decision layer. Generate a reverse index so each operator lists every rule that reads, adds, changes or removes it. | Rust catalog, web |
| Decision on the node | A resolved methodology view per node: `node → methodology_decision_id → MethodologyDecision`, with decision, evidence, citations, assumptions and checks. The inspector, the notebook and export all read it. | Contracts, Rust API, web |
| Notebook export | Export writes the resolved view as readable comments and structured notebook metadata, self-contained, so the notebook makes sense outside sprisk. | Python, web |
| Edit states | Three explicit states: generated, parameter-edited, custom code. Each shows what is verified and what is only assumed. | Contracts, web |
| Check applicability | Checks apply by typed outputs, flow structure and declared obligations, not operator id. A custom node with `train` and `test` outputs still gets the overlap check. The UI separates verified invariants from unverified assumptions. | Rust scheduler, Python checks |
| Automation | A web Start action for the walk engine, once `engine/core` is merged and authorized. | Web, Rust |

## 7. Priorities

| Priority | Work | Reason |
| --- | --- | --- |
| P0 | Fix the rule proposal bug on split steps (§3.6) | Existing decisions are misreported |
| P0 | Show methodology and verification state on nodes and cells | Makes existing information visible |
| P1 | Resolve `MethodologyDecision` during notebook generation and export | Keeps the reasoning in exports |
| P1 | Rule settings and the choice as editable lines in the cell (§3.7) | Users control decisions where they work |
| P1 | Decouple Gate B applicability from operator ids | Stops silent loss of checks |
| P2 | Generated, parameter-edited and custom-code states | Makes edit impact clear |
| P2 | Operator-to-rule reverse index | Discoverability without moving rules |
| P3 | Web Start action for the merged walk engine | Automated methodology from the app |

## 8. ADRs

1. [ADR-0062](../adr/0062-decision-centered-methodology-and-edit-aware-verification.md), proposed: covers three items in one ADR.
   - Rules found by decision, with an operator-to-rule index.
   - Per-alternative assumptions and checks.
   - Edit-aware verification and the resolved methodology view.
   It replaces the three edit states in §6.2 with four separate facts: linked, modified, stale, and a result per obligation.
2. Still to write: in-cell settings and choice (§3.7).

P0 items need no ADR: the bug fix and showing data that already exists.

A second review (2026-10-23) set aside a larger redesign. It proposed scientific procedures, methods, scientific tasks and a capability registry. Most of it already exists as rules, alternatives, `MethodologyDecision` and the engine. ADR-0062 keeps three of its ideas and lists the rest as rejected.
