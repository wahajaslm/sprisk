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

**A guess is never built on.** A rule that reads a question fact still marked `inferred` (a guessed time column, say) is an Ask, not applied, whatever it recommends: the person's answer may change the decision (ADR-0059: a guess is confirmed before anything depends on it). A target is accepted only when stated or confirmed.

**The level belongs to the rule.** A rule recommends a route only when practice settles it from facts. When it depends, the rule recommends nothing and the engine compares the routes (Try). There is no separate level field: the rule's author and its reviewer own that line.

**A Try is the model selection a person would run.** For a rule that recommends nothing on a step, the engine asks for that step's model selection (`POST /pipeline_versions/{id}/model_selection/{step}`, ADR-0050): the shortlist's models, or the rule's preparation routes, scored on the same repeated folds with a fixed seed against a baseline. It records a `compare` step, waits for the comparison's run, then applies the winner in the next round through the same Apply. With no winner (no candidate beats the baseline on the same folds) it stops as a `limitation`, as the map's loop-back row says; a preparation comparison always has one, since its reference stands when nothing beats it. A comparison of another rule on the same step is `uncovered`.

**A Try is held to what the scores may not change** (ADR-0059).
- It waits for every open Ask: a person's answer may change what is compared, or how it is scored.
- It needs the success bar stated: the bar's metric is what the routes are scored by, fixed before any score.
- A new comparison is a new look at the folds. Past the loop-back rule's `max_looks` for the flow's family, the walk stops as a `limitation` rather than fit the folds.
- A comparison run still going (started by a person, or left by a walk that stopped mid-run) stops the walk as an `error`, to walk again once it ends. A run that failed or was cancelled, say at the walk's deadline, gives way to a fresh one.

**One action per round, in decision order.** A rule's change comes first, then a run, then a comparison: the comparison then scores the flow as the rules left it. Each round the engine reviews the head version and takes the first item in the review's `next` list that it can act on. An Ask holds back only the rules that wait on it; the review already says which. The engine then reviews again. It stops when nothing in `next` is actionable.

**Typed stop reasons.**
- `complete`: nothing is open.
- `needs_person`: only Asks are open. The walk lists them.
- `limitation`: a rule's recommended route reports a limit, such as no lift over the baseline.
- `uncovered`: an open item has no engine action yet (for example two sources and no active join rule). The walk names it.
- `run_failed`: the head's run failed and no rule can act on what it produced. It is named before any Ask, with each failed step and its error, since later steps were never judged. A failed run alone does not stop the walk: for Rakuten the first run fails at the split (the target is in the second file), yet the join rule reads both loads' outputs. A version is run at most once, so a `needs_run` that stays open after its run is not actionable.
- `stale`: the head version changed outside the walk.
- `source_changed`: a source file's content no longer matches its hash at the start. Added to the contract with slice 3, which checks the hashes.
- `error`: the engine could not take its next step (for example a source that was removed). The detail carries the error, so a walk never stays `walking` with nothing driving it.
- `budget_exhausted`: the walk used its actions or its time.

**Kept from the loop ADR.**
- *Budgets.* A walk has a maximum number of actions and a deadline. Both are required; there is no unlimited default.
- *Frozen inputs.* Each source's SHA-256 is recorded at the start and checked before each run.
- *Hold-out scored once.* Rules read train rows and cross-validation results only. When the walk is complete, the engine adds one Evaluate step on the test rows, runs it once, records the score and ends. No rule reads that score, and the walk never continues after it.
- *Stale-action checks.* Every action names the version it was decided on. Apply refuses a proposal whose flow changed (`check_current`); the walk stops `stale` when its head gained a version it did not make.
- *Restart safety.* The walk and each step are stored before acting. Apply keys are derived from the walk and the round, so a replayed apply returns the saved decision. A restarted server resumes walks that were walking, from their stored head.

**Reuse, no second scheduler.** The engine is Rust (it orders and schedules; rules decide in Python). It calls the same functions as the review, Apply, model selection and run endpoints, and runs through the existing scheduler. Every version it makes is an ordinary `PipelineVersion` with an ordinary `MethodologyDecision`, so the UI, CLI and an AI agent see exactly what a person would have made (rule 4).

**Records.** `Walk` (contract `walk.schema.json`): question, sources (their hashes come with slice 3), budget, head version, status (`walking`, `stopped`) and stop reason. Budgets are bounded like a study's: 1 to 200 actions, 1 second to 7 days. It is the one mutable control record. `WalkStep` is immutable: the round, the version reviewed, the action (`build`, `run`, `apply`, `stop`; `compare` from slice 2), the rule and alternative, the version or run it made, and why. The trail is the steps in order.

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

Known gap: the looks cap and the stop for a comparison run still going have no API test yet. Delivered with slice 3, not slices 1 and 2: source hashes and `source_changed`, resuming walks after a restart, the hold-out scoring, and the two-source join (its rule is drafted in another branch).

## Arch doc edits
- §8.3: the engine applies the review's actions in a loop; a person is asked only for Asks.
- §21: the engine is the M4 core; hand-built flows are an add-on.

## Amendments
- 2026-10-23: **Frozen inputs are checked (slice 3).** A walk records each source's SHA-256 when it begins (`Walk.source_hashes`, in the order of `sources`; optional, so walks saved before still load and are not checked). Every round hashes the sources again before its review and once more before it acts: a change stops the walk as `source_changed`, naming the file and both hashes. A run is never judged in the round that made it, so a source written during a run is caught by the next round's check. A source that cannot be read, such as one removed, stops the walk as `error`. Hashing reads each file in chunks, once per check: bounded memory, and a cost that grows with the walk's rounds only.
- 2026-10-23: **A restarted server resumes its walks (slice 3).** `serve` takes up every walk still walking, in the background. When the walk's last step names a run or comparison still queued or running, that run is driven to its end first, through the scheduler's own resume (in-flight attempts time out and are retried as new attempts), then the walk takes rounds again. Two windows a stopped server could leave are closed: a run and the step naming it are stored in one transaction; and an apply saved before its step is recognised by its round's key (`<walk>-round-<n>`), so the walk records that step instead of stopping as `stale`. A resumed run gets the same plan checks as its first start (data roots, key columns left out). A server that finds another has taken a round steps back instead of stopping the walk. Known gaps: a comparison claimed but not yet recorded as a step finds its run still queued and stops the walk as `error`, to walk again (the window lasts between the claim and the step); and two servers may both drive a left run until one records the round, with no lease on the walk yet.
- 2026-10-23: **The test rows are scored once (slice 3).** When the review leaves nothing open, the walk adds one Evaluate (`score_test`) on the test rows of the step whose train rows the model fits on, and on the test words of the step whose train words it reads, so they are prepared as the train rows were. The version, its run and a `score` step (a new walk action) are stored together, and the run is driven once; Gate B checks it like any run. The next round reads that run's own metrics and stops `complete`, leading with the success bar's metric and whether it is met. A model step still the baseline is not scored: nothing was chosen, so the walk stops as a `limitation` with the test rows sealed. The scored version is sealed too: proposing or comparing on it is refused (`test_rows_scored`), and any older proposal on its parent is stale. A restart during the scoring run finishes it. The version carries no `MethodologyDecision`: no rule made it. Known gaps: a second walk on the same question and files splits the same rows and scores them again, since spent test rows are not recorded yet; the score has no baseline beside it on the same rows; the scores are text in the stop's detail, not a typed record; the baseline-only stop has no API test.
