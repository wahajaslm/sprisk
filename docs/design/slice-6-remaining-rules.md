# ADR-0063 slice 6: the 16 remaining rules

Status: proposal, for approval before any more conversion. Done so far: batch A (six data rules
before the split, `fc2e861`) and batch B1 (text and dates, `4b10119f`). Batch B2 is written but
not committed; it is redone to fit this plan.

## Why this plan

Batches A and B1 each found something methods could not do, and the fix was designed on the
spot. This plan names everything the remaining rules need first, so the conversions become
mechanical, and lists what each old behaviour becomes, so nothing is dropped silently.

## Three facts that shape it

1. **Hand-built steps lose their rule.** Several rules judge a step a person placed (a fill,
   scale or clip step). Methods act only in walks. After slice 6, a hand-built flow keeps the
   Gate B checks (split leakage, code leakage, split design), not these rules.
2. **Scaling and skew transforms are harmless to trees.** A tree splits on order, and both keep
   order. So they can be added for any model, and no method needs to know the model family.
   The linear model does not scale its own inputs (`LogisticRegression` on raw columns), so
   they matter.
3. **Model selection is a comparison on folds.** So is item 4 (feature variants compared on
   folds). One mechanism serves both.

## Design: what methods gain

| # | Change | Why | Contract |
|---|---|---|---|
| D1 | `needs.statements`: a method may read named question statements (task, costs, interpretability, success_bar). Only stated or confirmed values; a guessed one is asked in the look, as concepts are today. | Costs, the success bar and interpretability decide thresholds and shortlists. | `MethodNeeds.statements` (optional), `MethodRequest.statements`. |
| D2 | A `set` action: an option sets settings on the step with a role, from settings or statements, keeping its operator. | The decision threshold puts the costs on the model; a shortlist sets nothing else. | `MethodAction.set` (optional). |
| D3 | A compared method: `compare: true` makes the engine score every open option on the same folds and choose by ADR-0050 (one-SE rule, baseline test). The options of the model shortlist come from the registry's models, as today. | Model selection, and item 4's feature variants, are one mechanism. | `Method.compare` (optional). |
| D4 | Comparison results as evidence: the select step produces `models.comparison` (metric, best score, baseline score, beats baseline, looks). | Loop-back reads results like any evidence. | Producer manifest only. |

All additive and optional, so `sprisk.method/v2` stays. Each lands with tests and an ADR-0063
amendment before any conversion that uses it.

## Kept, changed or dropped, rule by rule

Legend: **kept** = same behaviour in walks; **changed** = said how; **dropped** = gone, with why.

### Question rules (no data needed)

| Rule | Becomes | What changes |
|---|---|---|
| objective | dropped | The Objective page already refuses Start until the goal and success bar are stated (ADR-0060). Kept: the look asks to confirm a goal that is only a guess, and for the success bar, so the API asks what the page asks. |
| target_definition | dropped | Same: the page requires the target or "exploration". The "derived target" alternative never applied. |
| hard_constraints | dropped | Same: the page asks for interpretability. The rule only asked; it constrained nothing. |
| unit_of_prediction | dropped | Repeated items and the split method decide grouping from evidence. This rule only asked, and its "group split" option changed no step. |
| interpretability_requirement | dropped | The model shortlist already leaves the forest out when interpretability is high. |
| error_costs | method (D1) | Kept for two-class questions: asks for the two costs if missing. Reads the target's classes from `target.shape`. |
| decision_threshold | method (D1, D2) | Kept: sets the stated costs on the model, so it predicts at the cheapest threshold. Kept: not applied when the split keeps time order or whole items (inner folds shuffle rows). Changed: reads the error-costs and split decisions; also checks there are two classes. |

### Feature rules (the model's train rows)

| Rule | Becomes | What changes |
|---|---|---|
| rare_categories | method | Kept: groups categories over 15 values (under 1% become "other"). Changed: an identifier-like column is named, not asked about; column roles already drops identifiers before the split. |
| missingness | method | Kept: fills gaps before the model, median when skewed, else mean; text gaps get their own value. Kept: mostly empty (60%+) and unfillable columns are named, not filled. Dropped: the branch judging a person's fill step (fact 1), including the zero-fill question. |
| categorical_encoding | method | Kept: one-hot for up to 15 categories. Changed: possible integer codes are named, not asked; an answer had no option to apply. Dropped: the least-squares note, which almost never fired. |
| (new) wide categories | method | A column still too wide for one-hot is its own decision, `features.wide_categories`: one option inserts one `leave_out` step before the model, instead of the model's `exclude` setting. Encoding reads it, so it runs after. |
| skew_transform | method | Changed: applies to any model (fact 2), not only linear. Kept: Yeo-Johnson on numbers skewed past 1.0; 0/1 columns excluded. Runs after encoding. |
| feature_scaling | method | Changed: applies to any model and task (fact 2). Kept: robust scaling when heavy-tailed, else z-score; 0/1 columns excluded. Runs after the skew transform. Dropped: the branch judging a person's scale step (fact 1). |
| outlier_treatment | dropped | It judged only a person's clip step (fact 1); the engine never adds one. |

### Model rules

| Rule | Becomes | What changes |
|---|---|---|
| model_baseline_selection | compared method (D1, D3) | Kept: the shortlist (baseline always, linear always, forest unless interpretability is high or under 100 rows), compared on folds by ADR-0050. |
| loop_back | method (D4) | Kept: stop when no model beats the baseline; proceed when the bar is met; at most 3 looks. Changed: "reopen" stops the walk naming what to change, as the walk does today (it never went back). |
| clustering_algorithm | dropped | The walk needs a target and never builds a clustering flow; the rule always picked k-means. Clustering returns as a method when the walk explores. |

## Order of work

1. D1 and D2, then error_costs and decision_threshold.
2. B2 redone: rare categories, missing values, encoding (with `leave_out`), skew, scaling.
3. D3 and D4, then model selection and loop-back. Item 4 reuses D3.
4. Remove the old format: rules, `applies_to`, the fixed fact list in `facts.rs`, the old
   review routes, and the old-format tests in one commit. Until then the old-format tests are
   left as they are, on the rules that still exist.

## Decisions for you

1. Hand-built steps (fill, scale, clip) lose their rule; Gate B checks remain. **Recommended: yes.**
2. Five question rules are dropped because the Objective page already asks. **Recommended: yes.**
3. Scaling and skew apply to every model, since they cannot hurt a tree. **Recommended: yes.**
4. Model selection becomes a compared method (D3), shared with item 4. **Recommended: yes.**
