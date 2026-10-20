# ADR-0046: How a shortlist is compared
Status: Accepted
Date: 2026-10-21
Arch doc sections: §5, §9 (caching), §11. Builds on ADR-0044, ADR-0031, ADR-0028.

## Context
- ADR-0044 says what a comparison is: one cross-validate step per shortlisted model, fed by the split's train rows, and one select step that writes a SelectionDecision.
- It leaves four mechanics open:
  - how a cross-validate step names the model it runs, so the compiler, the cache and the worker agree;
  - how one select step reads a result per candidate when the shortlist's length varies;
  - where the comparison graph lives, so it does not make the shortlist proposal stale;
  - how a person starts one through the API.

## Decision
- **A step names a model by operator ref.** A params property marked `x-sprisk-model-operator: <key>` holds a model operator's ref; property `<key>` holds that model's params.
  - The compiler refuses a ref that is not a registered model with `model.estimator`, and checks `<key>` against that model's `params_schema`.
  - The step's implementation digest includes the model's digest, so editing the model's code invalidates the cached comparison (§9).
  - The worker passes the step the model's unfitted-estimator function, imported from a trusted pack like any entrypoint, and checks `<key>` again.
  - A step that names a model cannot carry its own code (ADR-0028): the code must stay the checked one.
- **A model's estimator function takes `schema` and the model's params except `target` and `features`.** The worker checks this when it loads the manifest. Given only the column types, it cannot learn from rows.
- **A per-fold result is a table.** `sprisk.ml.cross_validate` writes one row per fold: score, validation rows, and a digest of which rows they were. `sprisk.ml.select_model` lists its inputs by candidate id with `x-sprisk-ports: input` (ADR-0031), and refuses results whose metric, folds, seed or fold rows differ.
- **A comparison is a side version, not an edit.** It holds the split, the steps before it, the cross-validate steps and the select step. It has no `parent_id` and sets `PipelineVersion.compares` to the proposal. So Apply still works on the proposal, and the flow's head is unchanged. Rules refuse to propose on a comparison.
- **Only after a random split, for now.** Folds are shuffled. After a temporal or group split they would validate on rows before the ones they fit on, or on groups they also fit on, so compare refuses those flows until time- and group-aware folds exist.
- **`cross_validate` is an `estimator`; `select_model` is a `decision_evaluator`.** Gate B's leakage check then fails any cross-validate step fed a split's test rows, built by compare or by hand, before any step runs.
- **`POST /methodology_proposals/{id}/compare`** builds and stores it, and returns it; the client runs it with `POST /runs` like any version. One comparison per proposal: a repeat returns the same version. `POST /pipeline_versions` refuses `compares`, so a comparison always shows what the compare step built.
- **Protocol constants live in Rust:** 5 folds, seed 0, balanced accuracy or RMSE by the question's task. Each TrialSpec records them.
- **"Beats the baseline" means** the mean paired improvement over the baseline is larger than one corrected standard error, √((1/k + n_validate/n_train) · s²). The correction is Nadeau & Bengio's (2003), applied to k-fold as Bouckaert & Frank (2004) do. The one-standard-error bar is ours: a screening rule, not a significance test, and not adjusted for several candidates. Every SelectionDecision says so in its limitations.

## Alternatives considered
- **Params name the estimator function.** Rejected: a submitted graph could make the worker import and call any function.
- **The cross-validate step reads model manifests itself.** Rejected: operator code would reach into the worker's catalog, and the cache would not see the model's code.
- **Results as JSON with one select input per candidate.** Rejected: an operator's ports are fixed; named ports are tables.
- **The comparison as a child of the flow.** Rejected: Apply refuses a proposal whose flow has a child, and the comparison would become the flow's head.

## Consequences (good and bad)
- Good: a new model plugin is compared, cached and invalidated with no compiler, scheduler or UI change.
- Good: identical folds are checked, not assumed.
- Bad: a feature made by a step between the split and the model is missing from the split's train rows; that candidate's step fails with the missing column.
- Bad: `x-sprisk-ports` now serves an operator that is not a code step.
- Bad: flows with a temporal or group split cannot be compared yet.
- Bad: the select step's output is checked against the SelectionDecision contract only in tests and by the UI, not by the worker: plugin code may not import contract types (ADR-0022).

## Validation
- A comparison graph never reads a split's test or holdout port; a hand-built one that does fails Gate B.
- A step naming an unregistered or non-model operator, or with wrong model params, fails to compile.
- Changing a model's code changes the cross-validate step's cache key.
- Applying the winner after a comparison builds the replaced model step, and the comparison does not make the proposal stale.

## Notes
- `PipelineVersion` stays `/v1`: `compares` is optional and every stored version lacks it.
