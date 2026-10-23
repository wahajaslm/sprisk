# The investigation model: activities over rules

Status: Proposed design. Input to an ADR. Nothing is built.
Date: 2026-10-23.
Architecture: enterprise v2 §7 (investigation), §8 (methodology), §9 (runs), §11 (evaluation), §14 (layout).
Builds on: ADR-0042, ADR-0052, ADR-0055, ADR-0059, ADR-0060 and [ADR-0062](../adr/0062-decision-centered-methodology-and-edit-aware-verification.md).
Problem: [hidden-methodology-problem.md](hidden-methodology-problem.md). Methodology review (2026-10-23): two blockers and four majors fixed in this text.

## 1. Why this design

sprisk should run a scientific investigation by itself, from a question and data, and stop only for what a person must decide. ADR-0062 repairs how today's rules are linked and shown. It does not make the engine investigate.

Two read-only analyses on 2026-10-23 tested the current design:

- **Rakuten gap analysis.** The current engine covers the first half of a Rakuten investigation: question, join, cleaning, split, words. It cannot do the second half: diagnostics, imbalance, tuning, error analysis, loop-back, images. The Rakuten-shaped walk test (`crates/sprisk-api/tests/api.rs`) stops after `vectorize_words`, before any model comparison.
- **Code-design audit.** Rules read a closed list of about 40 facts (`facts.rs`). A new measure needs Rust code in several layers. A rule sits on an operator (`applies_to`) that is often not the step it builds. YAML action params are mostly ignored.

The verdict: the first half needs more rules and operators, as before. The second half needs three things the engine cannot express. This design adds them.

| Missing ability | Rakuten example | Today |
| --- | --- | --- |
| **Run an analysis before deciding** | "Are these listings the same product?" needs a near-duplicate check first | A rule sees only the fixed profile |
| **Decide related things together** | Text features × model × class weights × tuning, scored on the same folds | A Try compares one rule's routes on one step |
| **Go back with new evidence** | Error analysis shows two product types get confused, so revisit text features | `reopen` stops as `uncovered` |

## 2. The core idea: a scientific activity

An **activity** resolves one scientific question. It is the unit the engine plans with.

| | Rule (today, kept) | Activity (new) |
| --- | --- | --- |
| Answers | One decision: `split.method` | One question: "How do we evaluate fairly?" |
| Holds | `decide()` and its alternatives | The decisions that answer the question, the diagnostics they need, and how they are tried |
| Can produce | One effect on one step | Zero, one or many steps, a finding, an ask, or a limitation |
| Lives in | `methodology/<pack>/rules/<rule>/` | `methodology/<pack>/activities/<activity>.yaml` |

Rules stay. They become the detailed judgments inside activities. `decide()` is unchanged.

### Tiny example: repeated observations

```yaml
# methodology/common/activities/repeated_observations.yaml
id: data.repeated_observations
question: "Is the same thing in the data more than once, and does it matter for evaluation?"
stage: data
decisions:
  - data.exact_duplicates        # rule exact_duplicates
  - data.key_duplicates          # rule key_duplicates
diagnostics:
  - sprisk.diagnose.near_duplicates   # same title or image under different ids
informs:
  - split.method                 # data_split reads this activity's outcome
```

What the engine does with it on Rakuten:

1. `exact_duplicates` decides from the profile: drop 0 rows.
2. `key_duplicates` returns `needs_diagnostic(near_duplicates)`.
3. The engine runs the diagnostic on features only, before the split. Result: 1,240 listings share a normalized title with another. These are **candidate** duplicates, a proxy for "same product".
4. `key_duplicates` decides again with that evidence. Treating candidates as one product is an assumption, so it asks the person to confirm. It shows group sizes and how the count changes with the threshold.
5. Once confirmed, `data_split` reads `decision.data.key_duplicates` and picks a group split. Groups are the connected components of candidate pairs, so if A matches B and B matches C, all three are one group. The split keeps class shares with `StratifiedGroupKFold`, and reports group sizes and class shares on each side.

No rule here knows about another rule's internals. They talk through decisions and facts.

## 3. Three new abilities

### 3.1 Diagnostics: a rule can ask for an analysis

- A rule may return a fourth status, `needs_diagnostic`, naming a diagnostic and its settings.
- A **diagnostic** is an ordinary registered operator with `capability_class: diagnostic`. Its manifest declares the facts it publishes:
  ```yaml
  id: sprisk.diagnose.near_duplicates@1.0.0
  capability_class: diagnostic
  publishes: [input.near_duplicate_groups, input.near_duplicate_rows]
  ```
- The engine adds it as an Explore step, runs it, and stores its result as an artifact. The facts it publishes become readable by rules.
- **The fact catalog opens up.** Facts are declared by the profile and by diagnostic manifests. Today they are a hard-coded list in `facts.rs`. A new measure becomes a new diagnostic plugin, with no Rust change (arch §15.1).
- **Leakage guard: every diagnostic declares a row scope**, `all`, `train` or `per_fold`. Rust refuses any other combination:
  - `all` (before the split): features only, never the target. Its facts may decide only the split's groups or strata, cleaning, and reporting. They never set fitted settings.
  - `train` (after the split): may read the target. Advisory only, such as a finding or an ask. It never removes features or changes model inputs on its own.
  - `per_fold`: anything that removes features or changes model inputs from target-aware evidence is repeated inside each CV fold, as `fits_on_train` steps are.
- **The split is sealed after the first model run.** If a decision the split reads changes after that (for example `key_duplicates`, or a diagnostic threshold), the result is a new holdout record flagged "split changed after results".
- **The user sees it:** a diagnostic is a step with a cell and a chart. One step, one cell (ADR-0055).

### 3.2 Joint Try: an activity decides related things together

- An activity may declare a `search`: the decisions it tries together.
  ```yaml
  id: models.text_classifier
  question: "Which text features and model predict the product type best?"
  search:
    decisions: [features.text_representation, models.shortlist, models.class_imbalance]
    tune: true                     # include each model's manifest search space
    budget: { trials: 40, time: 2h }
  ```
- The engine runs this as one **study** (ADR-0052). It builds the allowed combinations, up to the budget, plus a baseline (`DummyClassifier`, prior and most frequent) on the same folds.
  - **The inner CV of the train split picks the winner.** Its routes are applied together through the normal Apply.
  - **The outer folds estimate the whole search procedure.** They never pick the winner (ADR-0050).
  - **The winner's inner score is never reported as its performance.** It is biased upward by the search.
  - A winner must beat the baseline on the same folds, or the activity stops as a `limitation`.
- **The selection metric is fixed by the question before any score**, for example weighted F1 for Rakuten. It is never chosen after error analysis.
- **The budget's binding limit is the trial count.** The seed and the sampler are recorded. A time limit is a safety stop. A walk cut short by time is marked not reproducible.
- Studies already run a bounded search for one model step. This extends the search space from one step's settings to several decisions' routes. There is still no second scheduler.
- A rule that recommends nothing still means "try my routes" (ADR-0060). The activity says which rules are tried together.

### 3.3 Reopen with evidence: going back is part of the plan

- `reopen` names the activity to revisit and the new evidence. For example, `error_analysis` publishes `cv.confused_classes` and reopens `models.text_classifier`.
- The reopened activity runs again with the new facts available. Its rules can decide differently because they now see more, not because they are asked twice.
- Error analysis uses out-of-fold predictions inside the train split only.
- **Each reopen is another look at the same folds, so scores after it are biased upward.** `max_looks` limits how many reopens can happen. It does not remove the bias. So:
  - Every score after a reopen is labelled "post-reopen, selection-biased".
  - The record keeps the number of looks and every configuration tried, from every look.
  - A re-search always includes the earlier winner, so a reopen cannot end on a worse model.
- The final holdout is still scored once, after the walk ends. No reopen can read it. **Only the holdout score is reported as an unbiased estimate.**

### 3.4 Decisions read decisions

- `decision.<key>` facts, designed in ADR-0059 and specified in ADR-0062 §1, are a prerequisite. They are how `data_split` sees `key_duplicates`.

## 4. How the engine plans

The engine still reviews, takes one action, and reviews again (ADR-0060). What it reviews changes.

**Investigation state = activities, each with a status.**

| Activity status | Meaning | Engine action |
| --- | --- | --- |
| `open` | Its question is not answered | Ask its decisions |
| `needs_fact` | A person must answer | Stop and ask |
| `needs_diagnostic` | A rule asked for an analysis | Add and run the diagnostic step |
| `needs_run` | Evidence needs a run | Run the head version |
| `searching` | Its joint Try is running | Wait for the study |
| `resolved` | Its decisions are applied | Nothing |
| `reopened` | New evidence arrived | Ask its decisions again |
| `limitation` | It cannot be resolved here | Stop and report |
| `uncovered` | sprisk has nothing for it | Stop and name it |

**Order** comes from what activities need: an activity is ready when the facts and decisions its rules read exist. This reuses the rule ordering by `reads` (ADR-0059), one level up.

**Where steps go.** An activity names the step role its outcome is about, such as `split`, `model` or `none`. A role is read from the operator manifest, not from a list of operator ids. This replaces `applies_to` as the anchor. A decision with no step, such as reporting or fusion, has role `none`.

## 5. What it looks like for a person

### 5.1 Flow

The canvas is unchanged: steps and arrows. A step shows the activity that made it. Diagnostics appear as Explore steps.

### 5.2 Notebook

One notebook per stage stays (ADR-0055). Inside it, **each activity is one section**, not one text cell per step:

```
## Repeated observations
Question: is the same thing in the data more than once?
Finding:  1,240 listings share a title with another (candidate duplicates; confirmed by you).
Decision: split by candidate-duplicate group.   [rule key_duplicates · sources]

[cell] near-duplicate titles      (diagnostic, chart)
[cell] group split                (plain Python)
       ✓ no candidate-duplicate group in both train and test
```

The text is generated from the resolved methodology view (ADR-0062 §4). It is never stored in `Node.notes`, so it cannot drift.

### 5.3 What a person can change

| Change | Example | What happens |
| --- | --- | --- |
| Objective or a fact | "Generalize to new products, not new listings" | Activities whose rules read that fact reopen. A change after results is recorded as post hoc, since it changes what is being estimated. |
| Assumption | "Same title does not mean same product" | Answer the activity's ask; dependent decisions are decided again |
| Method | Group split → random split | Override with a reason (ADR-0042); dependents reopen |
| Settings | Test share 20% → 30% | A setting change; affected checks go stale |
| Search | Remove random forest from the text classifier search | Edit the activity's search for this walk |
| Implementation | Rewrite a cell | ADR-0062 §3: link kept, checks stale or not assessed |

Each activity section starts with one **generated settings cell**. It holds the activity's settings and choices as values:

```python
# Repeated observations · settings (synced; change values only)
near_duplicate_title_threshold = 0.9
split_by = "product"        # or "listing"
```

It is read back the way ADR-0055 reads back a ready-made step: values only, checked against the settings schema. Any other edit is refused. Plain assignments in a person's own cells never govern methodology. This replaces the plain-line proposal in the problem statement §3.7.

## 6. Code design changes

From the audit. Each item is small and stands alone.

| # | Change | Fixes |
| --- | --- | --- |
| 1 | Facts are declared by the profile and diagnostic manifests, not hard-coded in `facts.rs` | New measures need no Rust change |
| 2 | Lists are typed in the observation contract, not `", "`-joined strings | Rules stop parsing text by hand |
| 3 | One helper for the task, with one rule about trusting a guessed task (`authoritative`) | Three different readings today |
| 4 | Fact labels come from the fact catalog, not a `LABELS` dict in each rule | Boilerplate in 8 rules |
| 5 | YAML says what really happens: `action.params` is either used or removed; `"{decision}"` goes | The manifest stops misleading readers |
| 6 | Drafts leave the rule folders. A draft becomes an `uncovered` row on the methodology map until someone writes its `decide()`. | 37 files in a dead format |
| 7 | Active menus name only registered operators; the catalog refuses others at load | Menus offering steps that do not exist |
| 8 | Operator defaults live once, in `params_schema` defaults; notebook writers read them | Forest defaults written three times |
| 9 | Rule tests live in each pack | All tests in the supervised pack today |

What stays: rule ids and folders, `decide(observation) -> RuleDecision`, `MethodologyDecision`, the Rust/Python split, contracts as the single source, one API path for UI, CLI and agents, and AI off by default. The engine stays deterministic. AI may later propose activities or diagnostics through the same typed path (hard rule 3). It is never needed.

## 7. Rakuten under this model

| Activity | Decides | Diagnostics | New here |
| --- | --- | --- | --- |
| Question | objective, target, task, metric | | |
| Sources | join | key matches | |
| Repeated observations | exact and key duplicates | near-duplicate titles (`all`, features only) | diagnostic, ask to confirm groups |
| Text quality | HTML, spelling, language, empty description | language, text length (`all`, reporting only) | diagnostics; anything fitted on corpus statistics is fitted inside folds |
| Evaluation design | split, folds | | reads `decision.data.key_duplicates`; sealed after the first model run |
| Leakage | target proxies, train/test overlap | single-feature scores (`train`, inside folds) | diagnostic; a flagged proxy is an ask, never an automatic drop |
| Text classifier | text features × model × class weights × tuning | | joint Try |
| Error analysis | confused classes, per-class F1 | out-of-fold confusion | reopens the text classifier |
| Final score | holdout once | | |
| Images | image features, fusion | | later |

## 8. Delivery, proved on Rakuten

Each slice is done when the Rakuten-shaped walk test gets further, on the synthetic stand-in. The real data is never in the repo.

| Slice | Builds | Rakuten walk reaches |
| --- | --- | --- |
| 0 | ADR-0062 P0: split panel bug, decisions shown on cells | (visibility only) |
| 1 | `decision.<key>` facts | Split reads duplicate findings |
| 2 | Diagnostics, with one diagnostic: near-duplicate titles | Group split by product, from evidence |
| 3 | Activity manifests; the engine plans by activity | Same walk, organized as activities in the notebook |
| 4 | Joint Try as a study over several decisions | A compared text classifier on folds |
| 5 | Reopen with evidence, from error analysis | A second look at text features, capped |
| 6 | Code changes §6, one at a time | No change in behaviour |
| later | Images and fusion | Text + image |

## 9. Rejected

- **Procedures, methods, scientific tasks and a capability registry** (second review). Mostly renames of rules, alternatives and `MethodologyDecision`. ADR-0062 records why.
- **Rules inside operators** (`needed()` next to `run()`). A decision can span several operators, and an operator cannot see the rest of the flow.
- **One big YAML with conditions.** A second language to build and test (ADR-0042).
- **An AI planner in the core.** The engine must work without AI (hard rule 3, ADR-0060).
- **Searching everything together.** Cost grows with every decision added. An activity names the few decisions that interact. All others are decided one at a time.

## 10. Open questions

1. **Grain.** How big is an activity? Proposal: one per question a reviewer would ask. That gives about 10 for supervised work.
2. **Cost of joint search on 85,000 rows.** The budget must hold. Slice 4 needs a measured run on the stand-in before any default is set.
3. **A diagnostic's own validity.** A diagnostic is code that can be wrong. Each needs tests on fixtures, like operators.
4. **Draft rules.** Moving them out of the rule folders (§6.6) needs the user's agreement. They hold research notes.
5. **One more concept.** Activities are new for contributors. The methodology map must show activities, rules and diagnostics together, or this repeats the obscurity it aims to fix.
