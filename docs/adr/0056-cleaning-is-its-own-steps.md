# ADR-0056: Cleaning is its own steps; a model step fits only the model
Status: Accepted
Date: 2026-10-22
Arch doc sections: §8 (methodology), §9 (runs). Builds on ADR-0050 (preparation inside each fold) and ADR-0055 (a step does one thing). Changes ADR-0046 (a model step no longer prepares its own features).

## Context
- A model step (`linear_model`, `random_forest`, `dummy_baseline`) fills gaps, one-hot encodes text, scales and fits the estimator, all in one step. Its notebook cell is one long block, and the Clean stage stays empty.
- That breaks ADR-0055's rule: a step does one thing. A person cannot see, or decide, how the data is prepared.
- ADR-0050 already compares whole pipelines: the `fits_on_train` steps between the split and the model are refit on each fold's training rows. Preparation can be its own steps without leaking.
- There is no step that encodes categories, and the encoding rule is a draft.

## Decision
**A model step fits only the model.**
- It takes numbers with no gaps. A text column or a gap is refused, naming the Clean step to add ("purpose is text: add Encode categories before the model").
- `features` becomes optional. Omitted, the model uses every column that reaches it except the target, so the columns Clean steps make are used as they are.
- The cost cut-off (ADR-0053) stays in the model step for now: it is part of fitting a costed model.
- The model operators get new major versions. Stored flows that pin the old ones stop running until their model is chosen again, as in ADR-0053.

**Preparation is Clean steps, one thing each, each `fits_on_train`.**
- Drop columns (`select_columns`), fill gaps (`impute`), encode categories (`encode`, new), scale numbers (`scale`).
- `encode` one-hot encodes the text columns it names, learning the categories from the train rows. A category seen only in test rows gets zeros. New columns are named `<column>_<category>`.
- A study refits them on each fold's training rows (ADR-0050), so preparation never sees a fold's held-out rows.

**The methodology decides the Clean steps.**
- Missing values (`missingness`, active) decides fill or drop.
- Encoding (`categorical_encoding`) becomes active: one-hot for low-cardinality text columns.
- Scaling (`feature_scaling`, active) no longer finds models that scale their own inputs, so it recommends scaling for linear models and none for trees.

**Checks keep seeing every step.**
- `encode` joins the steps `split_leakage` and `code_leakage` treat as fitting on train.
- An edit to a ready-made step's code that only changes values keeps the step and its checks; any other edit makes it a code step, and the notebook says the checks no longer cover it (ADR-0055).

## Alternatives considered
- **Show the model's internal pipeline as separate cells of one step.** Rejected: one cell is one step (ADR-0055); several cells per step brings back the matching problems of ADR-0037.
- **Pass an unfitted preprocessor between steps.** Rejected: it needs values other than tables between steps, and a person would still not see the prepared data.
- **Ordinal or target encoding by default.** Rejected: ordinal codes invent an order for nominal categories; target encoding leaks without cross-fitting.

## Consequences (good and bad)
- Good: the Clean stage shows how the data is prepared, step by step, and each step's result is a table a person can look at.
- Good: the model's notebook cell is short: the estimator, its fit, and its cut-off.
- Bad: a flow must have its Clean steps before its model runs on text or gaps. The rules propose them; a flow built by hand must add them.
- Bad: model operator versions change; stored flows need their model chosen again.
- Bad: one-hot columns multiply with categories; the encoding rule caps cardinality.

## Validation
- Python: `encode` learns categories on train only, gives unseen test categories zeros, and its plain code gives the same tables; a model refuses text and gaps with the step to add; models fit on prepared numbers predict as before on German credit.
- Methodology: the encoding rule recommends one-hot for German credit; a study with Clean steps refits them per fold.
- API: German credit built by the rules runs with Clean steps and a short model cell.

## Amendments
- 2026-10-22: **Key columns never reach a model.** A model with its features unset reads every column but its target and its `exclude`d columns. A run adds the key columns to `exclude`: the question's unit and time columns, and every step's group and time column. It does this for model steps and comparison candidates that list no features, from the stored version and question, so a rerun is the same. Rules measure the same columns. A model that lists its features reads only those.
- 2026-10-22: **The operator contract changed in place.** `sprisk.operator/v1` lost `prepares` without a new schema version, because no plugin outside this repo exists yet. Once one does, such a change gets a new version.
