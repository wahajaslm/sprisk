# ADR-0047: Sprisk's model-selection methodology
Status: Accepted
Date: 2026-10-21
Arch doc sections: §8, §11 (selection, final evaluation, holdout reuse), §15.1. Builds on ADR-0042, ADR-0044, ADR-0046.

## Context
- ADR-0044 and ADR-0046 compare a shortlist of models on cross-validation folds, but a person must start the comparison, and it picks the best mean, with ties broken by name.
- Choosing a model is the methodology's job. People need to see everything it did, and to try other models without fooling themselves.
- The standard protocol is settled in the literature (Hastie, Tibshirani & Friedman, *Elements of Statistical Learning*, ch. 7; scikit-learn "Common pitfalls"; REFORMS, Kapoor et al. 2024; TRIPOD+AI, Collins et al. 2024):
  1. fix the metric and the baseline before any score is seen;
  2. hold out the test rows and leave them alone;
  3. cross-validate the whole pipeline on the training rows, preparation inside each fold;
  4. use nested cross-validation when settings are tuned;
  5. compare on the same folds, with a test corrected for folds that share rows;
  6. pick the simplest model within one standard error of the best (the one-SE rule: Breiman et al. 1984; ESL §7.10);
  7. refit the choice on all training rows and score the test rows once;
  8. report everything.

## Decision
**The protocol above is Sprisk's model-selection methodology.** Each part is built as follows.

- **A candidate is a pipeline.** It is the preparation steps between the split and the model, plus the model, refit together on each fold's training rows.
  - A preparation operator declares `fits_on_train: true`: it reads train and test, fits on train only, and writes each from its own rows.
  - The worker wraps that step's own function as a fold transformer: fit stores the fold's training rows, and transform applies the step to new rows. A fold runs exactly the code the flow runs, and nothing is reimplemented.
  - The same flag replaces the API's hard-coded list of steps that keep train rows apart.
  - A step between the split and the model without the flag stops the comparison: such a step may mix rows, so the train rows cannot be traced to the split (ADR-0044).
  - A step refit per fold must also be pure and read no files: each fold runs it again, with no approval and no data-root check of its own.
- **Sprisk compares on its own.**
  - `POST /pipeline_versions/{id}/model_selection/{node_id}` resolves the model step's shortlist, builds its comparison and starts its run, or returns the ones it already has.
  - It changes nothing in the flow. The UI calls it when it shows a flow version that has run and whose model step a shortlist rule decides.
  - Compute is spent only on a version someone looks at, once.
- **The recommendation follows the one-SE rule.**
  - Models that do not beat the baseline are out.
  - Of the rest, the recommendation is the simplest model whose mean is within one corrected standard error of the best.
  - A model manifest declares `model.complexity` (0 = ignores its features), so a new model plugin is ranked with no rule edit.
  - Ties at equal complexity go to the best mean, then to the id. The reason says which step decided.
- **"Beats the baseline" becomes a test.**
  - The protocol becomes repeated stratified k-fold: 10 repeats × 5 folds.
  - The corrected repeated k-fold t-test is one-sided at α = 0.05 (Nadeau & Bengio 2003; Bouckaert & Frank 2004), with a Holm adjustment over the candidates.
  - Decisions made before the test have no p value; the UI then shows the one-SE screen they used.
- **Applying the recommendation needs no reason.** Apply reads the latest SelectionDecision of the proposal's comparison, checked against its contract. If the chosen model is its recommendation, it is not an override. Any other model needs a reason.
- **People may try other models.**
  - Each **Use this model** is a new flow version, branched from the compared version.
  - A shortlist proposal may be applied more than once. Its base does not go stale through branches that its own decisions made.
  - A decision taken after another branch of the same proposal has already scored the test rows records `test_rows_seen_by`, naming those versions (arch doc §11). The UI shows a caution beside both scores.
- **Everything is shown.**
  - Each cross-validate step also writes out-of-fold diagnostics from the training rows only: a confusion matrix or a predicted-against-actual plot, the fold scores, and permutation importance on each fold's validation rows.
  - The Experiments page shows the protocol, the shortlist and why, every model side by side, the rule step by step, and what was left out. Any two models can be compared in detail.
- **Data preparation is compared the same way, one decision at a time.**
  - A preparation rule's measurable alternatives are compared on the same folds, holding the other decisions at their recommendation.
  - Changes that alter the rows or the target change the question. Their scores are marked "not directly comparable" and never ranked.
- **Splits that keep time or groups apart** get matching folds:
  - `TimeSeriesSplit` on rows ordered by the question's time column;
  - `StratifiedGroupKFold` (classification) or `GroupKFold` (regression) on its entity column.

  A temporal split's folds are not repeated, since time order allows one set; the decision says the test is then a rough guide.

## Alternatives considered
- **Compare after every run, on the server.** Rejected: most runs are small edits, and the cost multiplies by the shortlist. A failure would have no one to show it to.
- **Search every combination of preparation and model.** Rejected: the best of many tries is chosen partly by luck (Cawley & Talbot 2010), and an honest search would need nested cross-validation everywhere.
- **Let people choose what to compare.** Rejected: the shortlist is a methodology decision with a reason. People choose from the results.

## Consequences (good and bad)
- Good: the model is chosen by a published protocol, and every step is visible.
- Good: trying another model is easy, and each look at the test rows is on the record.
- Bad: repeated folds cost ten times the compute of one cross-validation.
- Bad: a proposal now has many decisions, so "the decision of a proposal" no longer exists.

## Validation
- On iris, linear and forest score the same, so the recommendation is linear, and the reason says it is the simpler model within one SE.
- A model with no signal is never recommended, whatever the number of candidates.
- Applying the recommendation needs no reason; applying another does. A second branch records which version had already seen the test rows.
- With impute between the split and the model, the comparison refits the impute step in every fold and names nothing as left out.

## Arch doc edits
- §11: SelectionDecision follows the one-SE rule after a corrected test against the baseline; holdout reuse is recorded per decision.

## Amendments
- 2026-10-21: Preparation joins the folds through `fits_on_train` and a wrapper around the step's own function, not through a second `transformer` function per operator. One implementation per step, as rule 10 asks.
- 2026-10-21: Review fixes. `sprisk.ml.cross_validate` and `sprisk.ml.select_model` become `@2.0.0`, since their params changed; comparisons stored at `@1.0.0` can no longer be rerun, and Sprisk builds a new one when a version is next shown. Each version's step has one model selection, claimed in the store (`model_selections`), so concurrent requests share one comparison and one run. `model.complexity`, like `model.estimator`, is optional in the contract but required by the registry for a model with tasks. A temporal split that also keeps entities apart cannot be compared yet: time folds would mix entities.
