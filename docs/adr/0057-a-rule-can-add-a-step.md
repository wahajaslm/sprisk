# ADR-0057: A rule can add a step
Status: Accepted
Date: 2026-10-22
Arch doc sections: §8 (methodology), §9 (runs). Builds on ADR-0042 (rules decide and build steps), ADR-0043 (a decision can remove a step) and ADR-0056 (cleaning is its own steps).

## Context
- A rule can change a step (`replace_node`) or remove it (`remove_node`). It cannot add one. ADR-0042 planned `insert_step`, but it was never wired.
- Since ADR-0056, a model refuses text and gaps, naming the Clean step to add. Today a person must add that step by hand, and then ask its rule for settings.
- The user's rule: a flow is built only the methodological way. Every step comes from a rule's proposal.
- Example: German credit's model gets `purpose` as text. The encoding rule should see that and propose "add an Encode step for purpose, housing, … before the model". Today it cannot.

## Decision
**New graph effect `insert_node`**: `{ kind: "insert_node", node_id, operator, params, before }`. It adds step `node_id` in front of step `before`, on the rows `before` learns from.

**Where the step goes.** Only train/test steps (inputs and outputs `train` and `test`, `fits_on_train`) are inserted, so the new step learns from train rows only. Let S be the step whose `train` output feeds `before`'s `train` input.
- The new step reads `S.train` and `S.test`.
- `before` reads the new step's `train` instead of `S.train`, and its `test` too if it read `S.test`.
- A step that reads an output of `before` and `S.test` reads the new step's `test` instead. So a model's Evaluate scores test rows prepared the same way.
- Every other reader of S keeps reading S. An Explore chart still shows the rows as they were.
- Anything else is refused with a typed error, and nothing changes: `before`'s `train` is not fed by a `train` output, S has no `test` output, or the operator is not a train/test step.

**Declared in the rule manifest.** An alternative's action names the operator and the new step's id:
`action: { type: insert_step, operator: sprisk.clean.encode@1.0.0, placement: before, node_id: categories }`.
- `decide()` returns the params, as for `replace_node`.
- Rust builds the effect only for an applicable alternative, and only from the manifest's operator.
- A taken id gets a suffix (`categories_2`).
- The new step records its decision (`methodology_decision_id`), like a replaced one.

**Same path as every effect.** The preview is compiled before the proposal is stored. Apply builds a new `PipelineVersion` through the normal API (rule 4), and Gate B checks it. The rewiring is a pure function in `sprisk-methodology`, tested on its own.

**First user: encoding.** `categorical_encoding` becomes active, applies to model steps, and reads the model's input columns.
- Text columns with few categories: insert Encode (one-hot) before the model.
- Text with too many categories: named in the reason, since one-hot would make too many columns. No step can handle it yet.
- Target encoding and ordinal codes: not applicable. Target encoding leaks without cross-fitting, and ordinal codes invent an order.
- No text reaches the model: nothing to add.

## Alternatives considered
- **The encoding rule decides an Encode step a person added.** Rejected: the person must first know that text needs encoding. The rules should find that, and the user wants every step to come from them.
- **One planner that writes the whole Clean stage at once.** Rejected: one rule owns one decision, each with its own evidence (ADR-0042).
- **Insert the step for every reader of the split.** Rejected: Explore charts would show encoded rows, not the data as it was.
- **Let the rule return a whole new graph.** Rejected, as in ADR-0043: a private mutation path around typed effects (rules 3, 4).

## Consequences (good and bad)
- Good: from Load, Split and a model, the rules can add the Clean steps the model needs.
- Good: a study refits an inserted step on each fold, as any `fits_on_train` step (ADR-0050).
- Bad: test rows are rewired only for steps that read the model directly. A flow that reaches its test rows another way is refused, not guessed.
- Bad: only train/test steps can be inserted. A step before the split (such as dropping a column) needs its own placement later.
- Bad: missingness and scaling still decide steps that exist. They move to inserting when a dataset needs it.
- Bad: a comparison does not yet measure an inserted step against leaving it out.

## Validation
- Methodology: inserting before a model reads S's train and test, feeds the model and its Evaluate, and leaves an Explore chart on S; each refusal case changes nothing.
- Encoding rule: German credit's text columns get one-hot before the model; a column with many categories is named, not encoded; with no text, nothing is added.
- API: applying the encoding proposal on German credit gives a flow that runs, with Gate B passing.
