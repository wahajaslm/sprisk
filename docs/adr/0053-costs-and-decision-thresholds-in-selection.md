# ADR-0053: Costs and the decision cut-off are decided by a methodology rule
Status: Accepted
Date: 2026-10-21
Arch doc sections: §3 (Question), §11 (selection), §22 (EXP-02). Changes ADR-0045 (one rule per step). Builds on ADR-0042, ADR-0050, ADR-0052. Replaces the draft rule `probability_calibration` with the active rule `decision_threshold`.

## Context
- German credit (UCI) comes with costs: approving a bad applicant costs 5, refusing a good one costs 1.
- Every classifier in Sprisk predicts a class when its probability is over 0.5. Models are compared by balanced accuracy.
- Measured on German credit (stratified 5-fold CV, seed 0, scikit-learn 1.9.1), loss per 100 applicants:
  - approve everyone: 150; refuse everyone: 70;
  - logistic at 0.5: 86; forest at 0.5: 105;
  - logistic refusing when P(bad) ≥ 1/6: 52; forest the same: 53.
- So at 0.5 both models lose more than refusing everyone. With a cut-off that follows the costs, both beat it.
- Nothing in Sprisk knows this. Only a person did, by reading the data's documentation.
- The draft rule `probability_calibration` already describes the fix: with stated costs, set the cut-off from them. It cannot become active: a step has one active rule (ADR-0045), and model steps already have the shortlist rule.

## Decision
**Costs are a fact of the question.**
- A classification `QuestionVersion` may state `costs`, with its origin, like every fact:
  - `positive`: the class whose miss costs, as text;
  - `false_negative`: the cost of missing it;
  - `false_positive`: the cost of a false alarm.
- Both costs are positive. A correct decision costs nothing.
- Only a person can state them, so the origin is `explicit` or `confirmed`. Sprisk never infers costs.
- The fact catalog gains `question.costs`.

**A step may have one active rule per decision (changes ADR-0045).**
- A model step needs several decisions: which model, which cut-off, later how to weigh classes.
- So a rule is routed by operator and decision. Two active rules that decide the same thing on one operator are still refused when packs load.
- A proposal names its decision. The proposals route takes the decision: `POST /pipeline_versions/{id}/methodology/proposals/{node_id}/{decides}`. The old route keeps meaning the step's first rule, so existing clients work.
- The Parameters tab shows one panel per rule that decides the step.

**The draft `probability_calibration` becomes the active rule `decision_threshold`.**
- It applies to the model operators and decides `evaluation.decision_threshold`. It reads `question.task`, `question.time_column`, `question.entity_column` and the costs, as `question.costs.positive`, `question.costs.false_negative` and `question.costs.false_positive` (text facts, numbers as decimals).
- Its alternatives:
  - `cost_optimal_threshold`, when costs are stated: the model tunes its cut-off for least cost.
  - `default_half`, when no costs are stated: the 0.5 cut-off. Its proposal says the costs are unknown and that 0.5 assumes both mistakes cost the same.
  - Platt scaling, a draft alternative, is dropped. Calibration can return as its own rule when it has an operator.
- With a time or entity column, `cost_optimal_threshold` is not applicable yet. Its reason says so: inner folds for the cut-off do not yet follow time or groups.
- The rule's other text is checked against the course before activation (gap 10).

**`update_estimator_params` is wired.**
- An alternative with this action sets params on the step it decides. It sets nothing else.
- The manifest's `action.params` names the params the alternative may set, each as `"{decision}"`. The rule's decision gives their values; a named param the decision leaves out is removed. Any other param is refused. The compiler checks the result.
- A step's rules are listed in workflow order (by stage, then id), so the old proposals route still gives a model step its shortlist rule.

**A model with costs tunes its own cut-off.**
- The two-class model operators gain an optional `costs` param.
- With it, the model is wrapped in scikit-learn's `TunedThresholdClassifierCV`:
  - scored by expected cost (`make_scorer`, `greater_is_better=False`, `pos_label` = `positive`);
  - with 3 stratified, shuffled inner folds of its own training rows, seeded by its `seed`.
- It tunes on scores, so it needs no calibrated probabilities. A forest's are not calibrated.
- Not chosen: the fixed cut-off c_FP / (c_FP + c_FN). It is right only for calibrated probabilities.
- The dummy baseline cannot be tuned: scikit-learn refuses a model with constant predictions. With costs, it predicts the cheaper of "approve everyone" and "refuse everyone" on its training rows, through `FixedThresholdClassifier` at c_FP / (c_FP + c_FN) on its class prior. That is the floor a lender compares with.
- Because the cut-off belongs to the model, every fold of a comparison refits it on that fold's training rows. The applied model step tunes it on all train rows. Nothing else carries a cut-off.

**With costs, models are compared by expected cost.**
- The comparison reads the model step's `costs`. With them, its metric is `expected_cost`, lower is better, and each candidate gets the same costs. Without them, it stays `balanced_accuracy`.
- The corrected t-test, Holm and the one-SE rule are unchanged.
- Recall guardrails (ADR-0052) are measured at each candidate's tuned cut-off.
- The SelectionDecision records the share of `positive` rows in the train rows. Its limitations say the cut-off holds only at that share. German credit's 30% bad is a sampled mix, not a population rate.
- `evaluate` reports each tuned model's cut-off with its scores.

## Alternatives considered
- **Hard-wire "costs in the question, so compare by cost" in Rust.** Rejected: it hides a methodology decision in code. The person sees no proposal, rationale or source, and cannot choose otherwise.
- **Put the cut-off in the shortlist rule.** Rejected: one rule would own two decisions (ADR-0042).
- **A separate cut-off step after the model**, as the draft rule's `insert_step` said. Rejected: a comparison refits only preparation and the model per fold, so a later step's cut-off would be tuned outside the folds.
- **A cost guardrail with a bound.** Rejected: models would still be chosen by the wrong measure, and the bound would be a guess.

## Consequences (good and bad)
- Good: the decision is a rule's, with its source and rationale, and the same for every flow and client (rule 4).
- Good: the draft rules for model steps (`class_imbalance`, `model_interpretability`) can become active later the same way.
- Good: "refuse everyone" becomes a real floor.
- Bad: tuning adds 3 fits per model fit, per fold and per study trial.
- Bad: the model operators, `cross_validate` and `select_model` change versions. Stored flows that pin the old ones no longer compare until their model step is chosen again. `evaluate` keeps its version: its settings do not change, and it only reports the cut-off as well.
- Bad: two-class targets and random splits only, for now.
- Bad: the tuned cut-off is noisy on small data. German credit's innermost folds hold about 180 rows.

## Validation
- With costs 5 and 1, a model whose cut-off is 0.5 and that loses more than "refuse everyone" does not beat the baseline.
- The floor equals the cheaper of "approve everyone" and "refuse everyone" on each fold.
- A question without costs gets `default_half`, with a reason naming the unknown costs.
- With a time or entity column, `cost_optimal_threshold` is not applicable, and says why.
- On German credit with UCI's costs: the rule proposes the cut-off; applying it sets `costs` on the model step; the study compares by expected cost; every candidate reports its cost; the evaluated model reports its cut-off.

## Arch doc edits
- §3: a classification question may state costs.
- §11: a step may have one rule per decision. With costs, the cut-off rule makes models tune their cut-off, and models are compared by expected cost.
