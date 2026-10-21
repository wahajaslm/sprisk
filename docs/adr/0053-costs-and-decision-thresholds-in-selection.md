# ADR-0053: Costs and decision thresholds in model selection
Status: Proposed
Date: 2026-10-21
Arch doc sections: §3 (Question), §11 (selection), §22 (EXP-02, SCI-09). Builds on ADR-0050 and ADR-0052. Gives the draft rule `probability_calibration` its `cost_optimal_threshold` path.

## Context
- German credit (UCI) comes with a cost matrix: calling a bad customer good costs 5, refusing a good one costs 1.
- Sprisk compares classifiers by balanced accuracy, and each model predicts the class with probability over 0.5.
- Measured on German credit with stratified 5-fold CV (seed 0, scikit-learn 1.9.1), cost per applicant:
  - approve everyone: 1.50; refuse everyone: 0.70;
  - logistic at 0.5: 0.86; forest at 0.5: 1.05;
  - logistic refusing when P(bad) ≥ 1/6: 0.52; forest the same: 0.53.
- So at 0.5 both models are worse than refusing everyone. With a cut-off that follows the costs, both beat it.
- A minimum recall (ADR-0052) cannot say this. Its bound is a guess, and it ignores the cost of refusing good customers.

## Decision
**Costs are question facts.**
- A classification `QuestionVersion` may state `costs`: the class whose miss costs (`positive`), the cost of a miss (`false_negative`) and the cost of a false alarm (`false_positive`). Both costs are positive numbers. A correct decision costs nothing.
- Only two-class targets. A question with costs on a target with more than two classes is refused.

**With costs, the comparison metric is expected cost per row.**
- `metric_of` gives `expected_cost` when the question has costs, else `balanced_accuracy` as now.
- Lower is better, as for `rmse`. The corrected t-test, Holm and the one-SE rule are unchanged.

**Each candidate's cut-off is tuned inside the folds.**
- `cross_validate` wraps each candidate's whole pipeline (preparation and model) in scikit-learn's `TunedThresholdClassifierCV`. It scores by expected cost (`make_scorer`, `greater_is_better=False`, `pos_label` = `positive`).
- Its 3 inner folds split the outer training rows the way the outer folds split all train rows: stratified, by group (groups passed through metadata routing), or by time.
- It tunes the cut-off on scores, so it needs no calibrated probabilities. A forest's probabilities are not calibrated.
- Not chosen: the fixed cut-off c_FP / (c_FP + c_FN). It is right only for calibrated probabilities.
- With a study (ADR-0052), the cut-off is tuned within each trial. The outer folds are unchanged.
- The tuned cut-off is noisy on small data. German credit's innermost folds hold about 180 rows, about 55 of them bad.

**The floor is the cheaper constant decision.**
- scikit-learn refuses to tune a cut-off for a model with constant predictions, so the dummy baseline is not tuned.
- On each outer fold, the baseline is "approve everyone" or "refuse everyone", whichever costs less on that fold's training rows. It is then scored on the fold's validation rows.
- That is the floor a lender compares with. A model that cannot beat it does not win.

**Guardrails and prevalence.**
- Recall guardrails (ADR-0052) are measured at each candidate's tuned cut-off.
- Expected cost and the cut-off depend on the share of `positive` rows. The SelectionDecision records that share in the train rows. Its limitations say the cut-off holds only at that share. German credit's 30% bad is a sampled mix, not a population rate.

**The chosen cut-off is applied.**
- Two-class model operators gain an optional `threshold` param, the cut-off for `positive`.
- The cut-off to apply is tuned on all train rows, as study settings are. Using a choice writes it into the model step.
- `evaluate` reports, when the question has costs: expected cost on the test rows, the cut-off applied, the confusion matrix, and the floor's cost on the same rows.

**The draft rule.**
- `probability_calibration`'s `cost_optimal_threshold` alternative is met by this design. It inserts no separate step.
- The rule stays draft until its other alternatives are checked against the course (gap 10).

## Alternatives considered
- **A cost guardrail with a bound.** Rejected: a guard on top of balanced accuracy still picks models by the wrong measure, and the bound would be a second guess.
- **Calibrate, then use the fixed cut-off.** Rejected for now: one more fitted step per fold, and the fixed cut-off is still only as good as the calibration.
- **Tune the cut-off on the outer validation rows.** Rejected: that chooses on rows used to score, which overstates the result.

## Consequences (good and bad)
- Good: the decision answers the lender's question in the lender's units.
- Good: "refuse everyone" becomes a real floor, so a model that cannot beat it does not win.
- Bad: inner threshold folds cost 3 extra fits per outer fold and candidate, and per trial in a study. In a study that is 3 × (inner folds + 1) extra fits per trial and outer fold.
- Bad: `cross_validate`, `select_model`, the model operators and `evaluate` change versions. Stored comparisons at the old versions no longer rerun.
- Bad: two-class only.

## Validation
- With costs 5 and 1, a model that predicts at 0.5 and costs more than "refuse everyone" does not beat the baseline.
- The floor equals the cheaper of "approve everyone" and "refuse everyone" on each fold.
- The tuned cut-off never sees an outer validation row, after a random, group or time split. This is checked by row digests, as for inner folds.
- On German credit with UCI's costs, the decision reports cost per applicant for every candidate, and the applied model step carries its cut-off.

## Arch doc edits
- §3: a classification question may state costs.
- §11: with costs, models are compared by expected cost, and each candidate's cut-off is tuned inside the folds.
