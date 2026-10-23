# ADR-0063: Methods need evidence, operators produce it
Status: Proposed
Date: 2026-10-23
Arch doc sections: §4 (domain model), §8 (methodology), §9 (runs), §14 (layout). Builds on ADR-0042, ADR-0055, ADR-0057, ADR-0059 and ADR-0060. Narrows ADR-0062 and [investigation-model.md](../design/investigation-model.md). Tested in the spike `~/sprisk-spike` (13 tests) and its preview.

## Context
- A rule finds its step through `applies_to`, an operator id. The step it sits on is often not the step it builds: `exact_duplicates` sits on the split and adds Drop duplicates.
- A rule reads only a fixed list of about 40 facts (`facts.rs`). A new measure needs Rust code in several layers.
- Rules name meanings as fixed facts (`question.entity_column`, `question.time_column`). A new kind of meaning needs a core change.
- Verification is one check per rule, chosen by operator. A group split and a temporal split share it.
- Users cannot see which code is checked, and the web app cannot start a walk.
- The spike ported the split decision to a smaller shape and ran it on a Rakuten-shaped stand-in. It held up: no column names in methodology, no anchor, and checks that survive code edits.

## Decision

**Two kinds of folder.**
- A method folder holds `method.yaml` (what it needs, its options, what each option promises) and `method.py` (`decide()` and one `verify_<name>()` per promise).
- An operator folder holds `operator.yaml` (inputs, outputs, settings, the evidence it produces) and `operator.py` (`run()`).
- Each pack has one `concepts.yaml`: the meanings its methods and operators can ask for.
- Words: method, option, operator, step, evidence, verification, concept, binding, activity.

**Needs are matched to producers by name.**
- A method lists `needs: concepts, evidence, decisions`. An operator lists `produces:` with the evidence fields.
- The engine adds the producing operator, runs it, and passes the evidence to `decide()`. `decide()` may read only what it declared.
- Each evidence kind has one default producer. A project may pick another. Two defaults are refused when packs load.
- A method reads another method's decision by its `decides` key. A cycle is refused when packs load.

**Concepts and bindings replace column names.**
- Methods and operators never name a dataset column. A setting names a concept (`group: {concept: core.item_identity}`).
- A binding says which source means a concept in one project: a column, or a column made by a step. It records its assurance (stated, confirmed, rule) and who set it.
- An option may create a binding; a person confirms it when the method asks.
- The `question.*_column` facts become bindings.

**Options act through typed patches.**
- An option's action binds a concept, replaces the step with a role, inserts before it, or sets settings.
- Every change is a patch of `insert_node`, `replace_node`, `remove_node` and `set_input`, checked whole (ports exist, no cycle). A refused patch changes nothing.
- An operator manifest names its `role` (source, split, model) and, for a producer, where it `attach`es. Placement follows the manifest, not input names.
- A diagnostic that reads all rows may not read a concept of kind label. It is refused when packs load.

**Verifications belong to options.**
- An option lists the promises it makes. Each promise names the evidence it needs. Its producer runs on the step's outputs, whatever code made them.
- A result is pass, fail, inconclusive, not evaluated or stale. Stale means the code, settings or data changed since it ran. Stale is never shown as pass.
- A step edited into custom code keeps its decision and its promises (ADR-0062 §3).

**Activities group what people see.** A method names its `activity`. The canvas shows one stage card per activity. The notebook shows one section: question, finding, decision, cells and verifications.

**The web app starts a walk.** The Objective page gets a Start action that calls `POST /walks` (ADR-0060), as the CLI and an agent would (rule 4).

**Ownership (rule 2).** Rust loads packs, matches needs to producers, builds and checks patches, schedules, and tracks staleness. Python runs `decide()`, `verify_*()` and `run()`. Contracts: method and operator manifests, `Binding`, evidence records, and `MethodologyDecision` gains the option, its promises and its bindings.

## Relation to ADR-0062
- Replaces §1 (rules found by decision, reverse index): matching by evidence makes the anchor unnecessary.
- Adopts §2 (checks per alternative) as promises per option.
- Keeps §3 (the link survives edits) and §4 (one resolved view per step).

## Alternatives considered
- **Keep rules anchored on operators.** Rejected: the anchor is the cause of the coupling.
- **Rules inside operators** (`needed()` beside `run()`). Rejected: a decision can span steps, and an operator cannot see the flow.
- **One YAML with conditions.** Rejected, as in ADR-0042: a second language.
- **Separate files for concepts, evidence and checks.** Built in the spike, then rejected: six kinds of file were too many to follow.
- **A TypeScript control plane.** Rejected: rule 2 and a working Rust engine.

## Consequences (good and bad)
- Good: a new measure, meaning or method is a new folder. No Rust change (§15.1).
- Good: methodology works on any dataset, because column names live only in bindings.
- Good: every step on screen says which method made it, why, and whether its promises hold.
- Bad: two rule formats live side by side until the last rule is converted. The old format is removed with the last conversion, not before.
- Bad: placement by role assumes one step per role. A flow with two splits needs a placement rule first.
- Bad: one default producer per evidence kind needs a person or project setting to use another.

## Delivery slices
Each slice is done when the Rakuten-shaped walk test gets further on the synthetic stand-in, and the new UI shows it.
1. **Start in the web app.** The Objective page starts a walk on today's engine. You see Load → Split → baseline and the stops.
2. **Packs load methods, operators and concepts** beside the old rules. Contracts for both manifests and `Binding`.
3. **Evidence and matching.** Operators produce evidence. The engine adds producers by `attach`. Port `near_duplicates`.
4. **The split decision.** `data_split` becomes `repeated_items` and `split_method` with promises. The walk asks about repeated titles, then splits by group.
5. **Promises in the UI.** Stage cards per activity, notebook sections, and the step panel's Decision and Files tabs. Staleness on code edits.
6. **Convert the remaining active rules**, then remove `applies_to`, the fixed fact list and the old format.

## Validation
- The spike's 13 behaviours pass in sprisk: ask, confirm, group split, stratified split, stale then fail after an edit, missing target asked, an all-rows diagnostic reading the target refused, and no column names in methodology files.
- The new UI shows the walk the way the preview does: the same steps, decisions and verifications.
- After slice 6, no active method has `applies_to`, and `facts.rs` has no fixed fact list.

## Arch doc edits
- §4: add `Binding` and evidence records. `MethodologyDecision` records the option, its promises and bindings.
- §8: methods need evidence, operators produce it. Concepts and bindings. Promises per option.
- §14: `methodology/<pack>/methods/<name>/`, `methodology/<pack>/concepts.yaml`, `operator.yaml` beside `operator.py`.
