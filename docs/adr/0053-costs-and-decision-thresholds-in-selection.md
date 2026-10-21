# ADR-0053: Costs and decision thresholds in model selection
Status: Proposed
Date: 2026-10-21
Arch doc sections: §3 (Question), §11 (selection), §22 (EXP-02, SCI-09). Builds on ADR-0050 and ADR-0052. Gives the draft rule `probability_calibration` its `cost_optimal_threshold` path.

## Context
- German credit (UCI) comes with a cost matrix: calling a bad customer good costs 5, refusing a good one costs 1.
- Sprisk compares classifiers by balanced accuracy, and each model predicts the class with probability over 0.5.
- Measured on German credit with 5-fold CV, cost per applicant:
  - approve everyone: 1.50; refuse everyone: 0.70;
  - logistic at 0.5: 0.86; forest at 0.5: 1.05;
  - logistic refusing when P(bad) ≥ 1/6: 0.52; forest the same: 0.53.
- So at 0.5 both models are worse than refusing everyone. With a cut-off that follows the costs, both beat it.
- A minimum recall (ADR-0052) cannot say this. Its bound is a guess, and it ignores the cost of refusing good customers.

## Decision
**Costs are question facts.**
- A classification `QuestionVersion` may state `costs`: the class whose miss costs (`positive`), the cost of a miss (`false_negative`) and the cost of a false alarm (`false_positive`). Both costs are positive numbers.
- Only two-class targets. A question with costs on a target with more than two classes is refused.

**With costs, the comparison metric is expected cost per row.**
- `metric_of` gives `expected_cost` when the question has costs, else `balanced_accuracy` as now.
- Lower is better, as for `rmse`. The corrected t-test, Holm and the one-SE rule are unchanged.

**Each candidate's cut-off is tuned inside the folds.**
- `cross_validate` wraps each candidate in scikit-learn's `TunedThresholdClassifierCV`, scored by expected cost, with 3 inner folds of the training rows.
- It tunes the cut-off on scores, so it needs no calibrated probabilities. A forest's probabilities are not calibrated.
- Not chosen: the fixed cut-off c_FP / (c_FP + c_FN). It is right only for calibrated probabilities.
- The dummy baseline is tuned too. Its scores are constant, so it becomes the cheaper of "approve everyone" and "refuse everyone". That is the floor a lender would compare with.
- With a study (ADR-0052), the cut-off is tuned within each trial. The outer folds are unchanged.

**The chosen cut-off is applied.**
- Two-class model operators gain an optional `threshold` param, the cut-off for `positive`.
- The cut-off to apply is tuned on all train rows, as study settings are. Using a choice writes it into the model step.
- `evaluate` reports expected cost on the test rows when the question has costs.

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
- Bad: inner threshold folds cost 3 extra fits per outer fold and candidate.
- Bad: `cross_validate`, `select_model`, the model operators and `evaluate` change versions. Stored comparisons at the old versions no longer rerun.
- Bad: two-class only.

## Validation
- With costs 5 and 1, a model that predicts at 0.5 and costs more than "refuse everyone" does not beat the baseline.
- The tuned cut-off never sees an outer validation row. This is checked by row digests, as for inner folds.
- On German credit with UCI's costs, the decision reports cost per applicant for every candidate, and the applied model step carries its cut-off.

## Arch doc edits
- §3: a classification question may state costs.
- §11: with costs, models are compared by expected cost, and each candidate's cut-off is tuned inside the folds.
