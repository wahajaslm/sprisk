# ADR-0044: Models are shortlisted by a rule and chosen by cross-validation
Status: Accepted
Date: 2026-10-20
Arch doc sections: §5 (experiments are not a second scheduler), §6, §8.3, §11 (Study, TrialSpec, TrialAttempt, TrialResult, SelectionDecision), §15.1. Extends ADR-0042 and ADR-0043.

## Context
- A methodology rule proposes alternatives and recommends one; Apply builds one graph change.
- Which model fits best cannot be read from the data. It must be measured. A rule can only say which models are worth trying.
- Models are plugins. A custom or new open-source model must join the comparison with no change to rules, Rust or UI (§15.1).

## Decision
**Shortlist (phase 2)**
- A rule manifest may declare `selection: shortlist`. Its decision lists `shortlist` (alternative ids) and has no `recommended_alternative_id`. Rust checks that exactly one of the two is present, as the manifest says.
- **Candidates come from the registry.** A model manifest declares `model.tasks` (`classification`, `regression`). For a shortlist rule, Rust sends `candidates` in the observation: every model operator whose tasks include `question.task`, with its family.
- `decide()` returns one alternative per candidate, with a reason, and the shortlist. The dummy baseline is always on it.
- Each alternative is a `replace_node` of the model step with that candidate. Rust builds its params from the step's own params that the candidate's `params_schema` accepts, and compiles every preview, as for any proposal.
- Applying one candidate without a comparison needs a reason, like any choice that was not recommended.

**Comparison (phase 3)**
- Compare builds a new `PipelineVersion` through the normal API: one `sprisk.ml.cross_validate` step per shortlisted candidate, fed by the split's train rows only, and one `sprisk.ml.select_model` step reading their results. It runs through the normal scheduler: no second scheduler (§5).
- Each cross-validate step is a **TrialSpec** (candidate, params, folds, seed, metric); its attempt is a **TrialAttempt**; its per-fold scores are the **TrialResult**.
- Folds: `StratifiedKFold` for classification, `KFold` otherwise, shuffled with a fixed seed. The same folds for every candidate. scikit-learn `cross_validate` runs each candidate's own `Pipeline`, so preparation is fit inside each fold. The test rows are never an input.
- The metric is fixed before any score is seen: balanced accuracy for classification, RMSE for regression.
- `select_model` writes one immutable **SelectionDecision**: every candidate's mean and spread, the winner and why. A winner must beat the dummy baseline on the same folds by more than the spread of their paired differences; otherwise it says no model beats the baseline.
- Applying the winner is the shortlist alternative's `replace_node`, through the normal Apply, citing the selection.

**Custom models**
- A model is one plugin folder: a manifest with `model: { family, tasks, prepares, estimator }`, Python code and tests. `estimator` names a function that returns an unfitted scikit-learn estimator, so cross-validation can refit it per fold.
- Downloaded weights (e.g. Hugging Face) and remote model APIs need their own ADR first: network, safe formats, data egress and licences.

## Alternatives considered
- **Recommend the dummy baseline.** Rejected: it implies a winner, and the dummy is never the model to keep.
- **List candidates in the rule manifest.** Rejected: every new model would need a rule edit (§15.1).
- **One step that trains every candidate.** Rejected: candidates would share one attempt, so one failure hides the rest, and retries cannot be per candidate.
- **Cross-validate the rows the model step receives.** Rejected: preparation steps fit on all train rows would leak across folds (rule 8).

## Consequences (good and bad)
- Good: the model is chosen by measurement on train rows, with a recorded reason.
- Good: a new model plugin is shortlisted, prepared and compared with no other change.
- Bad: preparation steps in the flow between the split and the model are not part of the comparison; the SelectionDecision names them as a limitation.
- Bad: the shortlist field and `selection` add a second decision shape to rules.

## Validation
- A classification question with 40 train rows shortlists dummy and linear, not the forest; with 500 rows, all three. Each reason says why.
- A comparison never reads a split's test port; its folds and seed are in each TrialSpec.
- A model no better than the dummy on the same folds gives "no model beats the baseline".
- A test plugin model, added as one folder, appears on the shortlist with no other change.

## Arch doc edits
- §11: TrialSpec and TrialAttempt are a cross-validate step and its attempt; SelectionDecision is the select step's output.
