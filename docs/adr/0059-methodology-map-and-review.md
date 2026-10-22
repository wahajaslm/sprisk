# ADR-0059: The methodology map and its review
Status: Accepted
Date: 2026-10-22
Arch doc sections: §8 (methodology engine), §8.2 (rule kinds), §8.3 (decision lifecycle). Extends ADR-0042 and ADR-0045. Builds on ADR-0055 (stages), ADR-0056 (cleaning is its own steps) and ADR-0057 (a rule can add a step).

## Context
- Since ADR-0057 a rule can add a step. But a rule still runs only when a person asks it about one step. Nothing walks all the rules and says what is open.
- Rules declare a `MethodologyStage`, but nothing orders them by it. ADR-0042 listed cleaning before split.
- Cleaning rules measure train rows (rule 8), so the split must be decided and run first. The course does the same: split first, then explore and clean the train rows (`knowledge/`, Methodology_in_Data_Science, step 2). ADR-0055's flow stages agree: Load, Split, Explore, Clean, Model, Evaluate.
- Methodology is not one line. It branches on the question and the data, and loops back on evaluation results.

## Decision
**The methodology map is the rule packs plus the fact catalog.** No separate map file. What it decides, where and how is listed in [methodology-map.md](../architecture/methodology-map.md). Each row is, or becomes, one rule.

**Each decision climbs an evaluation ladder only as far as it needs** (§8.2 rule kinds):
1. **Rule** (invariant, conditional requirement): practice settles it from facts. Same facts, same answer.
2. **Try** (advisor): practice says "it depends". The routes are tried on the same cross-validation folds with a fixed seed and picked by a stated criterion.
3. **Ask** (domain judgment): only a person can settle it. A guess is marked `inferred` and confirmed before anything depends on it.

**Two orders, kept apart.**
- **Step order** is the flow's `Stage` (ADR-0055). Inside Clean, steps follow fixed slots: drop columns → outliers → fill → encode → scale → select. Nothing fitted on rows sits before the split. Structure (types, IDs, duplicates) may be measured on all rows; statistics only on train rows.
- **Decision order is derived** from what each rule `reads`: question facts need nothing; `column.*` and `rows` need the split and a run; `flow.*` needs the model step; `decision.<key>` needs the rule that decides it. A cycle is refused when packs load. `MethodologyStage` stays a label that groups decisions on the map.

**The review.** `GET /pipeline_versions/{id}/methodology/review` returns, in decision order, each rule that fits the question, with its subject step and one status:
- `settled`: the step carries this rule's decision;
- `proposal`: the rule wants a change; the proposal is stored as today;
- `needs_fact`: a question fact it reads is missing;
- `needs_run`: it reads train rows the flow has not produced yet;
- `waiting`: a rule earlier in the order is open;
- `no_subject`: no step for it to decide yet.

`next` lists the open items with nothing open before them. The review only reads and proposes. Apply is unchanged, one proposal at a time.

**Refinement needs proof.** A route that differs from common practice says why, and has a test that proves it: a check that fails under the old route, a benchmark over the scenario library, or a dataset where the old route breaks.

## Alternatives considered
- **The hand-written stage list as the order.** Rejected: it puts cleaning before split and goes stale as rules are added.
- **A separate map file.** Rejected: a second source of truth next to the rule manifests.
- **Guards in YAML.** Rejected again (ADR-0042): `decide()` returns `not_applicable` with its reason.
- **Evaluate rules in a Python worker** (ADR-0042). Superseded: Rust already builds observations and calls `decide()` in a bounded process. Ordering is scheduling, so Rust owns it. Python only decides.
- **Apply every recommendation automatically.** Rejected for now: a person applies each proposal; an "apply all" can come once the review is trusted.

## Consequences (good and bad)
- Good: one call shows what the methodology has decided, what is open, and what is blocked on a person or a run.
- Good: UI, CLI and a future AI agent walk the same map (rule 4).
- Bad: one `decide()` process per applicable rule per review.
- Bad: per-column fan-out, decision facts, level-2 tries for preparation, and loops on run results are later slices.

## Validation
- German credit with Load → Split → Model: the review lists split as settled, and missing values, encoding and scaling in decision order with their statuses.
- Before any run, a rule that reads train rows is `needs_run`, and rules after it are `waiting`.
- A question with no target makes the split rule `needs_fact`.
- A cycle in what rules read fails pack loading with both rule ids.

## Arch doc edits
- §8.3: add the review before proposals, and `insert_node` (ADR-0057) to the effect plan.

## Amendments
- 2026-10-22: **A decision on a step feeding the subject counts.** A rule that adds a step records its decision on that step, so the review counts the subject as decided when it, or any step it reads from, carries a decision of that rule.
- 2026-10-22: **Settings are free only within their schema.** A step that differs from the recommended route only in the route's `settings_schema` properties is settled when its values validate against them. So a setting must be a free choice: a value that changes what the method is (an embargo, an averaging mode) belongs in the decided params, not in `settings_schema`, before its rule goes active.
- 2026-10-22: **"Before the split" only when no split feeds the step.** A step after a split whose rows cannot be traced to train rows shows the real reason, since test rows may reach it.
- 2026-10-22: **Structure facts are measured before the split.** A rule may read `input.*` facts: the row and duplicate counts of the one table its step reads, and per column the type, the share of text values that read as numbers, how many of those have a leading zero, and the most common values that do not. They hold no statistics, so all rows may be measured. Rules on a split step use them (missing markers, wrong types, exact duplicates). A step that fits nothing and turns one table into one is added on that table, in front of the split; any other step is still added only on train and test rows (ADR-0057). Rules after the split wait for these, since they change the rows a model sees.
- 2026-10-22: **Question rules sit on steps every flow has.** A rule decides steps, so a question-stage rule names one: the load step for what needs no data (goal and success bar, target), the split for the unit, which counts distinct values before it, and the model step for what reads the target on train rows (task type, class balance, error costs; `target.*` facts). They check the question and ask; only the task type changes a step, the model's `task`. A question's acceptance criteria are one fact, `question.acceptance_criteria`, with the weakest origin among them.
- 2026-10-22: **Text spelling is a data rule.** Trimming and lowercasing fit nothing, so the spelling rule decides the split step from structure facts (values that merge once spaces and case, then accents, are ignored) and adds `clean_text` before it. It moves from the supervised cleaning stage to the common data stage.
- 2026-10-22: **Interpretability is a stated constraint, and a replacement keeps settings.** The question states `interpretability` (high, medium, low; only a person, like costs). The hard-constraints rule asks for it on the model step, so asking holds back no rule before it. With high, the interpretability rule replaces a forest by a linear model and the shortlist leaves forests off. A model replaced by another model keeps the settings the new one accepts (its features and costs); the rule's own settings win. Any other replaced step, such as a split, takes only the settings the rule decided.
- 2026-10-22: **Cross-validation results are facts.** Rules on evaluation read `cv.*` facts: the model step's own model selection (ADR-0050), its latest SelectionDecision. A version made by choosing the step's model has none of its own: it uses the selection that choice followed, which scored exactly this flow, so choosing the winner costs no look. The folds hold train rows only, so a rule that acts on them never tunes to the test rows.
  - The facts describe the step's own model as a candidate there: the metric, its mean fold score, the baseline's, whether it beats the baseline by the selection's own test, and whether the selection chose it (a model that lost or failed a guardrail was not). Only a comparison of models against a floor baseline gives them. Each rule that needs more (train-fold scores, recall per class) adds it with its slice.
  - No selection yet, or one that has not decided: `needs_run`, saying to compare the models first. The step's model not among the candidates: `not_applicable`.
  - A rule reading `cv.*` comes after every rule that decides its step or a step upstream and does not read `cv.*` itself. The results describe the flow as it is, so whatever may change the flow goes first. Same-step rules wait here, unlike other rules.
  - **A result can reopen a stage.** A rule's alternative may have the action `reopen`, naming a stage. When it is recommended the review shows `reopen` with that stage in `reopens`. It stays open until the flow changes: the person edits the stage, and the new version is compared again (unchanged candidates come from the step cache).
  - **Looks are counted.** `cv.looks` counts the decided looks in the flow's whole family (every version made from the same first version, whatever the step id): model selections whose run succeeded, and completed studies. A branch or a renamed model step cannot start the count again. `earlier_looks` in a SelectionDecision stays as it is: it records the looks at one version for the record; `cv.looks` caps the loop. Each look at the same folds makes the cross-validated score more optimistic (Cawley & Talbot 2010), so the loop-back rule stops at a cap and reports the count. No lift over the baseline stops at once: reopening until the selection's test passes would fish for a lift.
  - **The success bar is a number.** The question may state `success_bar`: a metric of the selection (balanced accuracy, expected cost, RMSE) and a score. Only a person states it, like costs. The text acceptance criteria stay for everything else. The bar is asked for at the model step, once the metric is known.
