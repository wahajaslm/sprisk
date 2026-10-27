# ADR-0063: Methods need evidence, operators produce it
Status: Accepted
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
- An operator folder holds its `manifest.yaml` (inputs, outputs, settings, the evidence it produces) and its Python `run()`, as plugins do today.
- Each pack has one `concepts.yaml`: the meanings its methods and operators can ask for.
- Words: method, option, operator, step, evidence, verification, concept, binding, activity.

**Needs are matched to producers by name.**
- A method lists `needs: concepts, evidence, decisions`. An operator lists `produces:` with the evidence fields.
- The engine adds the producing operator, runs it, and passes the evidence to `decide()`. `decide()` may read only what it declared.
- Each evidence kind has one default producer. A project may pick another. Two defaults are refused when packs load.
- A method reads another method's decision by its `decides` key. A cycle is refused when packs load.

**Concepts and bindings replace column names.**
- Methods and operators never name a dataset column. A setting names a concept: an option maps a param to one (`concepts: {group_column: core.item_identity}`), or an operator maps its own params.
- A binding says which source means a concept in one project: a column, or a column made by a step. It records its assurance (stated, confirmed, rule) and who set it.
- An option may create a binding; a person confirms it when the method asks.
- The `question.*_column` facts become bindings.

**Options act through typed patches.**
- An option's action binds a concept, or replaces the step with a role and sets its settings. Inserting before a step is added when a method needs it.
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
- §14: `methodology/<pack>/methods/<name>/`, `methodology/<pack>/concepts.yaml`, `manifest.yaml` gains `role`, `attach`, `scope`, `concepts` and `produces`.

## Amendments
- 2026-10-24: **Questions come first, in one list.** A walk that stops to ask several times, one question per stop, makes a person sit beside it. A person should answer everything once, then let the walk run to its end.
  - **Questions that need no data** (the target, the task, the success bar, hard constraints) are asked on the Objective page. Start stays disabled until they are answered (ADR-0060 gate).
  - **Questions found in the data** come from one look, the walk's first run. The engine builds the first flow, places the producers methods need, and runs it once before any rule acts. Producers that read every row may never read the label (the load check above). Nothing scores the test rows.
  - After that run, every fitting method decides, and every rule is reviewed. All asks are collected: methods' `ask`, rules that need a fact or read a guess, and a missing success bar. If any is open, the walk stops once, with reason `needs_person` and the asks as one structured list on its stop.
  - **A person answers on the question.** `QuestionVersion.answers` holds one option per decision key (`decides`, `option`). The next walk applies an answered option with assurance `confirmed`, so it does not ask again.
  - The walk then runs to its end. It stops only for results (complete, a limitation such as "no model beats the baseline"), a failure or a budget. A new ask after the look is a safety stop, never planned. It means the look missed it, which is a bug to fix in the method.
  - **A method's decision is recorded on its walk step** (action `decide`): the method, the option, its promises, the bindings it made and its patch. `MethodologyDecision` stays rule-shaped until slice 6, when the old rules go.
  - **Question facts as bindings, until slice 6.** A stated or confirmed `target`, `time_column` and `entity_column` count as bindings of `common.target`, `common.event_time` and `common.item_identity`. A guessed one is asked in the look, as `unconfirmed_reads` asks today.
  - Old rules that ask only after another rule acts (none in the Rakuten walk) still stop mid-walk until they are converted.
- 2026-10-24: **Slice 5: how promises are checked and shown.**
  - **A check reads what the split wrote.** A producer whose `attach` side is `output` reads the anchor's output of each input's name (`split.train`, `split.test`). The engine places it once a decision's option promises a verification that needs its evidence.
  - **A walk records its checks as a `verify` step**, after any finished run of a version whose decisions promise something. A run that failed after the split still measured what the split wrote. Each promise gets `pass`, `fail` or `inconclusive` from `verify_<name>()`, or `not_evaluated` when no step measured its evidence. Python never answers `stale`.
  - **One rule for staleness.** A check holds for a later version while the step that measured its evidence, and every step before it, are the same: operator, settings, code and inputs. The walk checks again only when that changed. A version a person edits on top of a walk's version shows the walk's decisions, and each promise whose evidence could have changed reads `stale`, with what its check found last. Data changes stay with the walk's source hashes (`source_changed`).
  - **The test rows stay sealed unless every promise passes.** Every rule settled with a promise not passing, or never checked on the flow, stops the walk as `unverified` before any test row is scored.
  - **Read views.** `GET /pipeline_versions/{id}/decisions` (`FlowDecisions`) gives the decisions of the walk that made a version or its nearest ancestor, with each promise's standing. `GET /methods/{id}/files` (`MethodFiles`) gives a method's `method.yaml` and `method.py` as the packs loaded them.
  - **The decision is in the Methodology tab, not a separate Decision tab.** The design's Methodology tab already lays out a step's rule, decision and alternatives; a method's decision takes the same columns there, so a step has one resolved view (ADR-0062 §4). The Files tab shows the step's code, then the files of each method that shaped it.
  - **One grouping for canvas, notebook and step list.** The steps a decision shaped sit in their activity's section, placed where the earliest of them would sit by stage; every other step keeps its stage. A cell added to an activity's notebook section takes its first step's stage.
- 2026-10-25: **A failed promise reopens the decision that made it.** Until now a failed promise only kept the test rows sealed, and the walk could do nothing about it.
  - **Ruled out.** A check that ends `fail` rules out the option in force when it ran, and every other option of that method making the same promise: another random draw that passes by chance is not a fair split. `pass`, `inconclusive` and `not_evaluated` rule nothing out. An inconclusive or unchecked promise still keeps the test rows sealed, as before.
  - **Decided again.** The method decides again. `MethodRequest.options` leaves the ruled-out options out, and `MethodRequest.ruled_out` says what each failed check found. In `decide()`, `ctx.ruled_out(option)` reads that, and choosing or asking a ruled-out option is refused.
  - **Only before anything is chosen on its rows.** When a comparison, a rule's change or the score came after the decision, the walk does not reopen it: it stops as a `limitation`. Reopening then would move rows that informed selection into the test rows.
  - **One decision in force.** A decision made again takes the place of the earlier one. Every decision that reads it (`needs.decisions`) is dropped and made again, with no option ruled out, since what it read changed. Until then, nothing that reads a reopened decision decides. `FlowDecisions` shows only the decisions in force.
  - **A person's answer is not applied again** when its option was ruled out. The method is asked once more, and its ask offers only the options left.
  - **No option left** stops the walk as a `limitation`, naming each option's failed check.
  - **Remedies today.** Test rows that repeat train rows after a random split: the split method asks for the question's item column, so each item's rows stay on one side. A time or item split that breaks its promise has no other fair split, and the task method cannot change the question's task: both refuse, with what the check found.
- 2026-10-25: **Slice 6, the data rules before the split.** Source join, missing markers, wrong types, column roles, exact duplicates and HTML text are methods. Each decision keeps its key (`data.join_sources`, `data.missing_markers`, `data.type_repair`, `data.column_roles`, `data.exact_duplicates`, `data.html_text`), so stored decisions stay comparable.
  - **One producer per question the data answers.** `number_text` measures placeholders and numbers stored as text together, since casting depends on marking. `column_roles` names identifiers and counts copies on the other columns: a row loaded twice under two row ids is still one observation. `html_text` names text holding markup. Thresholds that measure sit in the producer; those that choose sit in `method.py`.
  - **A concept param a producer does not require is optional.** It is filled when a binding names its concept and left out otherwise, so one producer serves questions with and without an item or time column. A required one still leaves the producer out and says what to state.
  - **An all-rows producer may name the label as a column it drops.** ADR-0064's `x-sprisk-excluded` now holds before the split too: the worker drops that column before the step runs, so the step never reads a label value. Column roles and HTML text use it to hold the target out.
  - **A second table is the one loaded table no step reads** (ADR-0059's rule, now for methods). A producer's input named `other` reads it, as does the `other` of a step a method inserts; a producer reading it only measures it, so the table still counts as unread. With none, the join producer is not placed and the join method keeps one source; with several, the walk names them.
  - **Order by need.** Column roles reads the join decision, so identifiers are dropped after a join that uses one as its key.
  - **Identifiers are dropped by name** with `sprisk.clean.drop_columns`, so a column a step adds (the item group) survives.
  - **A split that reads a producer's table moves the producer onto its rows.** When a split is replaced to read the column a producer adds, the producer now reads what the split read until then. Before, cleaning steps placed between the load and the split were bypassed.
  - A method's ask is used only when a person's answer picks one of its options. Values a person must explain, such as `'NA'` or `'1,000'`, are named in the reason and left as typed.
- 2026-10-25: **Slice 6, batch B1: the model's inputs.** Text representation and date parts are methods (keys `features.text_representation`, `features.date_parts`).
  - **Evidence on the model's train rows.** `sprisk.profile.model_inputs` attaches to the model's input and reads its train rows, the target held out. A method's insert before the model reuses the train and test wiring the old rules used.
  - **Every trained model has the role `model`**, not only the baseline, so the model step is found by role after a comparison replaces it. The baseline stays the role default.
  - **A method waits while a step before its rows may still change.** It does not decide while another undecided method could insert before, or replace, a step upstream of where its evidence is measured. Two methods inserting before the same step decide one at a time, in decision order. So the feature methods decide after the data steps before the split, on the rows the model will see. It replaces the old rules' fixed `TABLE_SHAPE` order, which is removed.
  - **Not yet:** a decision made again (a failed promise) does not drop the feature decisions measured after the steps it changes. Making an inserting method decide again would add its step twice, so this waits for inserts that replace their earlier step. Today only the split and task methods reopen, and both are checked before any feature method decides.
  - Next (B2, B3): rare categories, missing values and encoding; then skew, outliers and scaling, which depend on the model family.
- 2026-10-25: **Slice 6 plan and statements.** The remaining rules follow docs/design/slice-6-remaining-rules.md, approved by the user: what methods gain is designed first, and each rule's kept, changed and dropped behaviour is listed.
  - **D1, statements.** `needs.statements` names question statements a method may read: `costs`, `interpretability`, `success_bar`. They are never guessed, so nothing is confirmed first. `MethodRequest.statements` carries those the question makes; `ctx.statement(name)` reads one, None when unstated.
  - **D2, set.** An option's `set` gives settings to the step with a role, keeping its operator and other settings, from fixed settings or statements. The catalog refuses a statement the method does not need, and a setting some operator of the role lacks, so it holds whichever model a comparison picks.
  - **Error costs and the decision threshold are methods.** The threshold sets the stated costs on the model when the target has two classes and the split shuffles rows, as the inner folds that pick the threshold do. Equal stated costs go on the model too: the threshold stays at one half, and models are compared by expected cost, the metric the person chose. A `set` reading a statement the question does not make is refused, so a person's answer never records a step that sets nothing.
  - **Evidence on what a step writes waits for that step.** A method whose evidence is measured on a step's output (the split's train rows) waits while an undecided method may replace that step or insert before it. Two methods that would wait on each other go in decision order.
  - **Five question rules are dropped** (objective, target definition, hard constraints, unit of prediction, interpretability requirement). The look now asks for interpretability, beside the success bar, and to confirm a goal that is only a guess, so the API asks what the Objective page asks.
  - **Retired rules stay as test fixtures** (`tests/fixtures/retired_rules`) for the old format's tests, until the old format goes.
- 2026-10-27: **Methods carry their words for people.** A method states its `pitfall`, and each option its `description`, `when` and `rationale`, all required. These are the words the old rules had, so the map shows a method in its own words, never filler. Nothing that decides reads them. Until the old format goes, `GET /methodology_rules` lists each method as a rule built from these words, for display only: rule lookups, sources and the review never see it.
- 2026-10-27: **Asset bindings feed asset steps.** A question's `asset_bindings` name a folder of image or audio files and how a row finds its file: `link_column` holds the file name, or the optional `file_pattern` builds it from columns (`image_{imageid}_product_{productid}.jpg`). An asset step marks its folder setting `x-sprisk-asset-root` and its file setting `x-sprisk-asset-file`, each naming a modality; the engine fills both from the question's binding of that modality, when it measures and when a method inserts the step, as it fills a concept's column. A folder setting is also `x-sprisk-local-path`, so the API keeps it inside the data roots. A method whose `applies_when.assets` names a modality the question does not bind does not apply. Image and audio features are methods: frozen embeddings or acoustic descriptors are added before the model when at least 80% of rows have a readable file, and the modality is left out, with the reason, when fewer do.
