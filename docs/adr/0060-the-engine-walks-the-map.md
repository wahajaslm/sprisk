# ADR-0060: The engine walks the methodology map
Status: Accepted
Date: 2026-10-22
Arch doc sections: §7 (investigation), §8 (methodology engine), §11 (evaluation), §17.3 (durable work). Builds on ADR-0059 (map and review), ADR-0050 (model selection), ADR-0052 (studies) and ADR-0057 (a rule can add a step). Reconciles the deterministic investigation loop ADR (untracked on main as 0054, "Scientific rules drive a deterministic investigation loop") with ADR-0059, and overrules it where they differ.

## Context
- ADR-0059 gives one read-only review: every rule that fits the question, its step, its status, and what is next. A person still applies each proposal by hand.
- The loop ADR (main, untracked) describes a durable loop. It starts from a flow a person built (its §1) and adds a second kind of building block, the "strategy", next to rules.
- sprisk's product is the engine itself: given a question and data, it builds, runs and judges the whole flow, and stops only for what a person must decide. A hand-built flow is an add-on, not the starting point.
- The reference challenge is Rakuten product-type classification: two files (X and Y) to join, text columns, 27 unbalanced classes. Its data is confidential, so tests use a small synthetic stand-in with the same shape.

## Decision
**The engine starts from a question and data sources, never from a flow.** `POST /walks` takes a question revision, one or more local files and a budget. The engine builds the steps every flow has (ADR-0059 amendment, "question rules sit on steps every flow has"):
- one Load per source (format from the file's extension). The first source feeds the split: it holds the rows to predict on. Any other source has no reader yet; the join rule joins it (Rakuten's Y joins X on `unnamed_0`),
- one random Split with the fixed seed (`compare::SEED`) and a 20% test share,
- one baseline model on the question's target and task (the map's Baseline row: always a model with no features).

Rules then decide each step like any other. The split rule may replace the split; the shortlist compares the baseline with real models. With no stated or confirmed target, the engine stops at once and asks for one. It never guesses a target (rule 8).

**One kind of building block: the map's rules.** Each review item becomes one action, from its status and the rule's level:

| Review item | Level | Engine action |
| --- | --- | --- |
| `needs_run` | — | Run the current version |
| `proposal`, recommended alternative applicable | 1 Rule | Apply it |
| `proposal`, a shortlist | 2 Try | Compare on fixed folds with a fixed seed, apply the winner |
| `proposal` of a rule whose routes are tried | 2 Try | Preparation comparison, apply the winner |
| `needs_fact` | 3 Ask | Stop and wait for the person |
| `reopen` | — | Walk the reopened stage's tries; stop when there are none |
| `settled`, recommended route is a limitation (`emit_methodology_limitation`) | — | Stop and report it |
| `settled`, `not_applicable`, `no_subject`, `waiting` | — | Nothing |

There is no separate "strategy" kind. A Try is a rule whose routes are compared; an Ask is a rule that needs a fact only a person has.

**One action per round, in decision order.** Each round the engine reviews the head version and takes the first item in the review's `next` list that it can act on. An Ask holds back only the rules that wait on it; the review already says which. The engine then reviews again. It stops when nothing in `next` is actionable.

**Typed stop reasons.**
- `complete`: nothing is open.
- `needs_person`: only Asks are open. The walk lists them.
- `limitation`: a rule's recommended route reports a limit, such as no lift over the baseline.
- `uncovered`: an open item has no engine action yet (for example two sources and no active join rule). The walk names it.
- `run_failed`: the head's run failed and no rule can act on what it produced. A failed run alone does not stop the walk: for Rakuten the first run fails at the split (the target is in the second file), yet the join rule reads both loads' outputs. A version is run at most once, so a `needs_run` that stays open after its run is not actionable.
- `stale`: the head version changed outside the walk.
- `source_changed`: a source file's content no longer matches its hash at the start.
- `budget_exhausted`: the walk used its actions or its time.

**Kept from the loop ADR.**
- *Budgets.* A walk has a maximum number of actions and a deadline. Both are required; there is no unlimited default.
- *Frozen inputs.* Each source's SHA-256 is recorded at the start and checked before each run.
- *Hold-out scored once.* Rules read train rows and cross-validation results only. When the walk is complete, the engine adds one Evaluate step on the test rows, runs it once, records the score and ends. No rule reads that score, and the walk never continues after it.
- *Stale-action checks.* Every action names the version it was decided on. Apply refuses a proposal whose flow changed (`check_current`); the walk stops `stale` when its head gained a version it did not make.
- *Restart safety.* The walk and each step are stored before acting. Apply keys are derived from the walk and the round, so a replayed apply returns the saved decision. A restarted server resumes walks that were walking, from their stored head.

**Reuse, no second scheduler.** The engine is Rust (it orders and schedules; rules decide in Python). It calls the same functions as the review, Apply, model selection and run endpoints, and runs through the existing scheduler. Every version it makes is an ordinary `PipelineVersion` with an ordinary `MethodologyDecision`, so the UI, CLI and an AI agent see exactly what a person would have made (rule 4).

**Records.** `Walk` (contract `walk.schema.json`): question, sources and their hashes, budget, head version, status (`walking`, `stopped`) and stop reason. It is the one mutable control record. `WalkStep` is immutable: the round, the version reviewed, the action, the rule and alternative, the version or run it made, and why. The trail is the steps in order.

## Alternatives considered
- **Start from a hand-built flow** (the loop ADR, §1). Rejected: the engine is the product; a flow a person built is an add-on.
- **Strategies as a second kind of building block.** Rejected: two systems decide what to do next. The map's levels already say Rule, Try or Ask.
- **An engine in Python.** Rejected: ordering, budgets and runs are Rust's job (rule 2). Python still decides each rule.
- **A client-side driver** (CLI calling HTTP). Rejected: the walk would stop when the client does, and UI and CLI would each need their own copy.
- **Apply every proposal at once.** Rejected: one at a time keeps decision order, and each review sees the flow the last rule made.

## Consequences (good and bad)
- Good: one call builds, runs and judges a flow from a question and data. The person sees each version, each decision and why it stopped.
- Good: adding a rule extends what the engine does, with no engine change.
- Bad: a review per round runs one `decide()` process per applicable rule. Long walks are slow until reviews are cached by version.
- Bad: the engine can only do what active rules do. Gaps show up as `uncovered`, not as guesses.

## Delivery slices
1. From a question and a source, the engine builds Load → Split → baseline, runs it, applies every Rule-level proposal, reruns, and stops when only Asks and Tries remain. It returns the trail.
2. It runs the Tries (model shortlist, then preparation choices) as comparisons on fixed folds and applies the winner.
3. It is durable: budgets, restart without duplicating work, typed stop reasons, the hold-out scored once at the end.

## Validation
- Rakuten-shaped stand-in (synthetic text columns, a coded class target): the engine builds the flow from the question and the file, applies the rules that fit, and stops for the person with the trail.
- Same inputs, same trail: two walks on the same question and file make the same decisions in the same order.
- No target: the walk stops `needs_person` before building anything.
- A source edited during a walk stops it `source_changed`.
- A version applied on the head by someone else stops it `stale`.
- A restart in the middle of a walk finishes it without a second apply or run for the same round.

## Arch doc edits
- §8.3: the engine applies the review's actions in a loop; a person is asked only for Asks.
- §21: the engine is the M4 core; hand-built flows are an add-on.
