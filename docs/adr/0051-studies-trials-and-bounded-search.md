# ADR-0051: Studies, trials and bounded search
Status: Accepted
Date: 2026-10-21
Arch doc sections: §3 (Experiment), §5, §11, §21 (M4), §22 (EXP-01, EXP-02, SCI-09, SCI-10). Builds on ADR-0044, ADR-0046, ADR-0050.

## Context
- Sprisk compares a shortlist of models by repeated cross-validation (ADR-0050). Each model runs at the settings the flow gives it. Nothing tunes them.
- M4 needs studies and trials on record, budgets, and bounded grid or random search, so baseline and candidates are compared fairly and the history repeats.
- Tuning and comparing on the same folds picks settings partly by luck and overstates the score (Cawley & Talbot 2010). ADR-0050 step 4 requires nested cross-validation once settings are tuned.
- The course tunes with `GridSearchCV` over a whole `Pipeline` and reports `best_score_`. That score comes from the same folds that chose the settings, so it is optimistic. Sprisk keeps the pipeline-wide search and drops that score.

## Decision
**A study is a comparison with search trials and a budget.**
- `Study` (`sprisk.study/v1`) is a stored contract entity.
- A study belongs to one flow version and its model step. It has its own shortlist proposal, built the way `select_model` builds one.
- Its graph is a comparison `PipelineVersion` built by `compare.rs` (ADR-0046), with `compares` set to that proposal. It runs as one `Run` on the normal scheduler. There is no second scheduler (§5).
- `Trial` (`sprisk.trial/v1`) is a contract type with no table. The API builds each one from the comparison version and its attempts:
  - **TrialSpec:** one cross-validate step, which is one candidate at one set of settings. Its settings are the step's params, so it is immutable.
  - **TrialAttempt:** the run's `Attempt`s for that step.
  - **TrialResult:** that step's `scores` table.
- The automatic comparison of ADR-0050 is unchanged: one trial per candidate, no budget, no study record. A study is something a person asks for.

**What may be searched comes from the manifest.**
- A model manifest may declare `model.search`: for each setting, a finite list of values. Example: `min_samples_leaf: [1, 5, 20]`.
- The registry refuses:
  - a name that is not a params property;
  - the names `target`, `features`, `task` and `seed`;
  - a value its property schema rejects;
  - a list with fewer than two values.
- A request names a strategy only (`grid` or `random`, plus a seed). It never names settings or values.
- A model with no `model.search` gets one trial at the flow's settings. The baseline is one of these.

**Rust lists the trials.**
- Trials must be graph steps before the run starts. Rust builds and types the graph (rule 2), and each trial's settings must be checked by the compiler and be part of its cache key.
- `grid`: every combination, with `itertools::multi_cartesian_product`. This is the same set as `ParameterGrid` over lists, in manifest order instead of key order.
- `random`: one seeded shuffle of each candidate's grid (`ChaCha8Rng`, the same on every platform). Take its first *n* points.
  - This is a sample without replacement, as `ParameterSampler` draws when every setting is a list.
  - Taking a prefix means a larger budget keeps every point a smaller one drew.
- Not chosen: running `ParameterGrid` or `ParameterSampler` in Python. The graph would then depend on a worker's output.
- Not chosen: optuna's `GridSampler` or `RandomSampler`. Both run as an ask-and-tell loop around a live study. Adaptive search (e.g. TPE) can be added later as a strategy (§11).
- Out of scope for now: continuous ranges, such as log-uniform.

**Tuning is nested cross-validation.**
- The outer folds are the comparison's own: 5 folds × the split's repeats. That is 10 × 5 after a random or group split, and 5 after a time split. They are the same for every trial.
- `sprisk.ml.cross_validate` takes `inner_folds`, fixed at 3. For each outer fold, a trial:
  - scores itself on 3 inner folds of that outer fold's training rows;
  - is fit on the outer training rows and scored on the outer validation rows.
- Inner folds follow the split as outer folds do: stratified, by group, or by time. Within one outer fold, every trial of a candidate uses the same inner folds, seeded by the outer fold.
- A time-split trial fails when an outer fold's training rows cannot hold 3 inner time folds. scikit-learn's `TimeSeriesSplit` error says why, and the study ends `failed`.
- `sprisk.ml.select_model` tunes each candidate one outer fold at a time:
  - it takes the trial with the best inner mean, ties going to the first in study order;
  - it uses that trial's outer score as the candidate's score for that fold.
- This equals `GridSearchCV(refit=True)` inside `cross_validate`, because fits are deterministic for a fixed seed.
- The result is one score per outer fold for "this model, tuned this way". That is the score of a fixed procedure on the same outer folds as the baseline. So the statistics are unchanged:
  - the pairs are still fold by fold;
  - the overlap correction still uses the outer rows;
  - no outer validation row helps choose a setting.
- So the corrected t-test, the Holm adjustment and the one-SE rule work as before.
- Holm counts candidates, not settings. Settings are chosen inside each fold, so they are not separate tests.
- **The settings to apply** are chosen the way `GridSearchCV` chooses them on the full training rows:
  - each trial also scores 3 inner folds of all train rows;
  - the trial with the best mean wins.
  - That score is never reported as a performance estimate. The decision says the reported score describes the tuning procedure, not one fixed setting.
- Settings are not ranked by simplicity, because no manifest says which value is simpler. The one-SE rule ranks candidates as before.
- Outer scores of each trial are stored in its `scores` table. They are never used to choose, and the study does not show them.
  - The study shows each trial's inner mean (what the search saw) and how many outer folds chose it.
- Cost: each trial fits (outer folds × 4) + 3 times. That is 203 after a random split.

**Budgets are enforced in Rust.**
- A study request must state `max_trials` and `max_wall_seconds`. Neither has a default.
- `max_trials` is checked when the study is built:
  - **Grid:** more trials than the budget is refused with `422 over_budget`, naming the count.
  - **Random:** each tuned candidate gets *n* = (`max_trials` − one-trial candidates) ÷ tuned candidates, rounded down and capped at its grid size. Below 2 is refused. Any remainder is unused. The trials show *n*.
- `max_wall_seconds` sets a deadline, stored on the study row when its run starts. A resumed run keeps it.
  - The scheduler checks the deadline before leasing each step. Past it, the run ends `cancelled`, and the study ends `budget_reached`.
  - A trial already in flight finishes. Its overshoot is bounded by its operator's `timeout_seconds`.
- **Partial evidence is kept, and no decision is made from it.**
  - Finished trials keep their attempts and scores.
  - A partly searched candidate compared against fully searched ones would not be fair.
  - A new study with more wall time, or a larger random budget, reuses finished trials through the step cache (same operator, params and inputs). Only the rest runs.
- A trial that fails after its retries fails the run, as any step does. The study ends `failed`, and its finished trials are kept.

**Guardrails are explicit (EXP-02).**
- A study may declare guardrails when it is created, before its own scores exist. The first kind is the minimum recall of one named class, for classification.
- Each trial also writes that recall for every outer fold.
- A candidate's guardrail value is the mean over outer folds of its tuned recall, shown with its corrected SE. It passes when that mean is at least the bound.
- The t-test and Holm adjustment run over every candidate, as before.
- Candidates that fail a guardrail are removed before the best mean and the one-SE band are found. So a model that cannot win never sets the bar.
- If none passes, there is no winner, and the reason names the guardrail.
- Settings are tuned on the primary metric only. The decision states this as a limitation.
- The SelectionDecision records each declared guardrail. For every candidate, it records the value and whether it passed.

**Repeated looks are on the record (SCI-09, SCI-10).**
- Every study on a version and step is a new look at the same outer folds. A person who reruns studies and keeps the one they like is choosing best-of-many.
- Each SelectionDecision lists the earlier studies, and the automatic comparison if it ran, on the same version, step and folds. The UI shows the count.
- A study never reads the test rows. Gate B fails any graph that does.
- `test_rows_seen_by` keeps its current rule (ADR-0050): it covers the study's own proposal and its branches.
- Studies are shown one at a time and never ranked together. Where two are shown side by side, they are labelled "not directly comparable" if they differ in any of these: rows digest, folds, metric, inner folds, search space, strategy, seed, budget or guardrails.

**Choosing.**
- "Use this choice" works as for a comparison. The study's winner needs no reason; any other candidate needs one.
- The applied model step gets the candidate's flow params plus the settings the study chose for that candidate. The compiler checks them.

**API and storage.**
- `POST /pipeline_versions/{id}/studies/{node_id}` builds the study and starts its run. Body: `idempotency_key`, `strategy`, `seed`, `max_trials`, `max_wall_seconds`, `guardrails`.
- It follows the `model_selections` claim pattern. A `studies` table holds `idempotency_key UNIQUE` and the request as sent:
  - the same key and body return the saved study;
  - the same key with another body returns `409`, as `replays` does for decisions.
- `GET /studies/{id}` returns the study, its trials and its run. `GET /pipeline_versions/{id}/studies` lists a version's studies.

## Alternatives considered
- **One step per candidate running `GridSearchCV` inside `cross_validate`.** Rejected:
  - a failure loses every setting of that candidate;
  - Rust could not count or cache single trials;
  - a trial would be a model, not a setting.
- **Each setting compared against the baseline as its own candidate.** Rejected: the best of many tries wins partly by luck, and Holm over every setting loses power.
- **Decide from the trials that finished when the budget runs out.** Rejected for now:
  - candidates would be searched unequally;
  - the select step's inputs are fixed in its version.
- **Cancel the trial in flight at the deadline.** Rejected: it would add a kill path and a new attempt transition, while the step timeout already bounds the overshoot.
- **Settings and value lists in the request.** Rejected: free text would decide what runs, and a model's settings belong to its plugin (§15.1).

## Consequences (good and bad)
- Good: every trial is a durable, cached, retried step, so the budget and the history work per trial.
- Good: the comparison's statistics do not change. Tuning only changes what one candidate's fold score means.
- Bad: nested folds are costly. A 12-point grid on one model is about 2,400 fits.
- Bad: a study cut short gives no decision until it is rerun with a larger budget.
- Bad: the guardrail checks a mean, and settings are not tuned for it. A model just above the bar may fall below it on new rows.
- Bad: `cross_validate` and `select_model` change params. Stored comparisons at the old versions can no longer rerun, as in ADR-0050.
- Bad: `test_rows_seen_by` does not yet cover branches made from other proposals on the same step.

## Validation
- In a test, a better outer score is given to a trial with a worse inner mean. That trial is not chosen, which shows outer scores never choose.
- Inner folds never contain an outer validation row. This is checked by row digests.
- A grid larger than `max_trials` is refused with `over_budget`.
- A study past its deadline ends `budget_reached`, keeps its finished trials' attempts, and makes no decision. A rerun with more time runs only the missing trials.
- A smaller random budget's trials are a subset of a larger one's.
- Two concurrent requests with one key make one study. The same key with another body returns `409`.
- On German credit (UCI, CC BY 4.0), a tuned forest is compared with the baseline and the linear model. A minimum recall on the "bad" class is reported for every candidate, and a candidate below it does not win.

## Arch doc edits
- §11:
  - A Study is a comparison version with search trials and a budget.
  - A Trial is one cross-validate step: one candidate at one setting.
  - Tuning is nested inside the outer folds.
  - A budget reached keeps partial evidence and makes no decision.
  - A guardrail stops a candidate from winning, and is recorded per candidate.
  - Each decision lists the earlier looks at the same folds.
