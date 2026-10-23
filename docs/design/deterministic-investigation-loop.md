# Deterministic scientific investigation: implementation specification

Status: Proposed; implementation has not started.
Date: 2026-10-22.
Decision: [ADR-0054](../adr/0054-deterministic-investigation-loop.md).
Architecture: enterprise v2 §4, §7, §8, §11 and §21.

## 1. Outcome and scope

Sprisk shall use explicit scientific rules to decide what to investigate next, run a registered experiment, interpret its evidence, and continue or stop. No LLM is required anywhere in this loop.

The central behavior is:

```text
confirmed context + scoped observations + experiment history
    -> applicable hypotheses and experiments
    -> deterministic action selection
    -> existing compiler, scheduler and workers
    -> measured results
    -> hypothesis assessment and updated context
    -> next decision or recorded stop
```

Adaptive means that different measured results produce different subsequent experiments. It does not mean that rules rewrite themselves, that every possible scientific explanation is known, or that successful execution establishes scientific validity.

First release: local tabular classification and regression, existing supported split designs, model shortlists, finite model search, and one preparation comparison. A user selects an existing flow with a linked question. Creating a flow from natural language is outside this release. The underlying contracts allow other task families, but strategies advertise only implemented capabilities.

Completion of this specification means a reviewable design. Completion of the feature means the acceptance suite in §15 passes, including a diagnostic-dependent second experiment.

## 2. Current capabilities and required extensions

This table describes inspected implementation, not everything promised by older architecture documents.

| Concern | Current owner and implementation | Required work |
| --- | --- | --- |
| Questions | `question_version.schema.json`, API and SQLite; facts have value/origin | Add stable investigation head; keep free-text criteria distinct from machine-checkable guardrails |
| Node choices | `rule.py`, `RuleObservation`, `RuleDecision`, `decision.rs`; one active rule per operator | Keep this API; introduce result-driven strategy functions alongside it |
| Evidence | Check artifacts, selection artifacts, optional `MethodologyEvidence.artifact_id` | Pin evidence scope and include source identities in every decision |
| Apply | API `apply_methodology`, atomic store transaction, `replace_node`/`remove_node` | Revalidate evidence and investigation revision at commit |
| Comparisons | `compare.rs`, fold-local preparation, `cross_validate@3`, `select_model@4` | Reuse construction and numerics; expose structured outcome reasons |
| Studies | Model-node grid/random search; budgets, nested tuning, persisted requests | Add budgeted fixed comparisons and preparation studies through the same machinery |
| Execution | `sprisk-scheduler`, durable attempts, artifacts and cache | Reuse; prove restart ownership and deadline integration for the controller |
| Data | File-source operators and content-addressed outputs; no DatasetVersion entity | Pin existing artifacts and add explicit external artifact input bindings |
| Holdout history | Partial proposal/branch tracking; integration map notes study-check coverage gaps | Enforce development input scope; widen exposure accounting before final evaluation |
| UI | QuestionLedger, Parameters/Checks, Studies and Experiments | Atlas renders recorded hypotheses, experiments, assessments and next action |

`Study` currently describes a model-step search. Preparation comparison is implemented separately, and automatic comparison can start when the UI shows a version. Neither is already a budgeted investigation experiment. These are explicit implementation changes, not zero-cost adapters.

## 3. Ownership and architecture

| Responsibility | Owner |
| --- | --- |
| Scientific applicability, hypotheses, experiment proposals and assessment | Python methodology packs |
| Graph construction, schema validation, permissions, freshness, conflict resolution, budget accounting and lifecycle | Rust |
| Profiling, diagnostics, fitting, scoring and numerical tests | Existing Python operators and mature numerical libraries |
| Durability, idempotency, current revision and evidence references | Existing store and artifact modules |
| Explanation, preview, user choices and navigation | React; no scientific inference in the browser |

The scientific core exposes two pure functions:

```python
propose(context: InvestigationObservation) -> StrategyResult
assess(context: InvestigationObservation,
       action: InvestigationAction,
       result: ExperimentEvidence) -> list[HypothesisAssessment]
```

Pure functions have no file/network access, wall-clock reads, randomness or direct graph mutation. Given identical canonical inputs and implementation digests they return identical semantic outputs. Execution itself can have numerical nondeterminism; runtime/library versions and seeds are recorded, and rules use specified tolerances. Deterministic reasoning does not promise bit-identical GPU or numerical outputs.

Rust assembles bounded inputs, invokes trusted pack code through the existing bounded Python-process mechanism, validates its output and persists it. The worker cannot choose arbitrary import paths or executable commands. Longer diagnostics are normal operators scheduled as attempts.

## 4. Scientific vocabulary

**Fact:** a supplied or measured value with an exact source and scope. An asserted entity meaning is not a measured truth. Existing `Fact.origin` is preserved. A strategy declares which origins satisfy each prerequisite. Inferred values cannot silently satisfy confirmed-context requirements.

**Hypothesis:** a scoped, testable proposition from a registered strategy. Example: “One of the registered imputation alternatives improves this fixed pipeline's development metric by at least the declared amount.” It names a comparator, evaluation scope and assessment rule before execution. It does not claim why people behave as they do or establish causation.

**Experiment:** an authorized action that invokes a registered diagnostic or comparison. It reuses a `Run` or `Study`; there is no separate experiment scheduler or duplicate trial table.

**Assessment:** the result of evaluating a hypothesis against measured evidence: `supported`, `contradicted`, `inconclusive`, or `not_assessed`. It is immutable and carries evidence, scope, limitations, criterion version and numerical inputs.

**Decision:** the recorded choice of next action, including considered alternatives and reasons for excluding them. It is distinct from `MethodologyDecision`, which records applying a graph change, and from `SelectionDecision`, which chooses candidates within a comparison.

Failure to beat a baseline is normally `inconclusive`, not proof of equivalence or absence of signal. `contradicted` requires a registered criterion that explicitly establishes the opposite proposition. V1 strategies do not emit it without such a criterion. Operational failure produces `not_assessed`, not a negative scientific finding.

## 5. Contracts and persistence

Define all new wire shapes in `contracts/schemas/investigation.schema.json`, then generate Rust, Python and TypeScript types. The following field groups specify the implementation contract; this document does not install schemas or generated types. IDs use existing prefixed ULID conventions; digest keys use `ContentHash`. Unknown optional values are omitted, never null.

### 5.1 Investigation

`Investigation` is the mutable control record:

| Field | Meaning |
| --- | --- |
| `id`, `project_id`, `schema_version` | Identity and ownership; reuse existing `InvestigationId` |
| `revision` | Monotonic optimistic-concurrency counter |
| `question_version_id`, `pipeline_version_id` | Explicit selected branch; never inferred from newest global row |
| `scope?` | Frozen evaluation context described below; absent only while preparing inputs |
| `strategy_refs` | Enabled versioned strategies and implementation digests |
| `policy` | Execution mode, permitted experiment kinds, stop thresholds, budget |
| `status` | `preparing`, `ready`, `awaiting_input`, `awaiting_apply`, `running`, `paused`, `stopped` |
| `current_decision_id?`, `current_action_key?` | Current decision and dispatch reference |
| `stop_reason?` | Required only when stopped |
| `created_at`, `updated_at` | Operational timestamps |

Every change increments `revision` and appends an audit event in the same transaction. Full event sourcing is not required. Old decisions keep their original snapshots. User-authored branches remain branches; changing the active one is explicit.

### 5.2 Evaluation scope

`EvaluationScope` is an immutable value embedded in a decision and pinned by the investigation:

- Question revision, source artifact IDs/content hashes, split run/attempt and train artifact, split method and row-membership identity.
- Development protocol: task, target, features, grouping/time columns, metric/direction, folds/repeats/seeds and inner-fold settings where applicable.
- Declared guardrails, practical improvement threshold, finite search space, baseline and strategy versions.
- Operator/package implementation digests and numerical environment identity.
- Optional final-holdout identity with exposure state `unverified | unexposed | exposed`; the controller receives metadata only, never final labels or metrics.

Scope equality is purpose-specific: preprocessing variants may differ in the method being tested but must share data, target and evaluation partitions. A protocol comparison function returns the exact differing fields. Unsupported differences prevent assessment; they never become warnings beside a winner.

### 5.3 Observations and evidence

`InvestigationObservation` contains the pinned scope, relevant existing facts, typed profile/diagnostic measurements, current check/selection records, budget remainder and prior action/assessment summaries. Each item names its producing run/attempt/artifact and, where needed, a typed field path within that artifact.

Availability is explicit: `known | unknown | conflicted`. Missing metrics are unknown, never zero. Two incompatible authoritative facts yield `conflicted` and request resolution; a newer timestamp does not settle semantic conflict. Free-text reasons are display fields and are never parsed as branch conditions.

Rust loads only declared facts and bounded result summaries. Strategy history includes all relevant experiment keys and terminal outcomes, even when presentation history is paginated. If the configured input cap is exceeded, return `context_limit`; never silently omit old experiments and retry them.

### 5.4 StrategyResult, hypothesis and action

`StrategyResult` holds applicable hypothesis proposals, action candidates, missing facts and unsupported cases. A strategy can return an empty set with a reason. Rust validates every candidate against the registered manifest.

Each `Hypothesis` has a stable key derived from strategy, subject, proposition parameters and scope; a statement; applicability prerequisites; comparator; practical threshold; assessment rule/version; and expected result schema. It is embedded in the immutable decision that first proposes it. No separate mutable hypothesis table is necessary in v1.

`InvestigationAction` is a discriminated union. V1 kinds:

| Kind | Required payload | Authority |
| --- | --- | --- |
| `request_fact` | fact key, reason, expected type/origins | User supplies a new question revision; v1 keys must map to existing typed question fields |
| `resolve_methodology` | node, registered rule | Existing proposal service |
| `run_diagnostic` | registered experiment ref, scoped inputs, validated params | Normal diagnostic pipeline and run |
| `compare` | node, proposal/ref, study kind, fixed/grid/random strategy and explicit budget | Existing comparison builder and study service, extended as §8 |
| `propose_apply` | proposal, alternative, exact selection artifact | Existing preview and Apply service |
| `stop` | typed reason, outstanding hypotheses, evidence | Records conclusion about this search scope |

Every action also carries hypothesis keys, scientific reason, expected evidence, priority class, declared dependencies and conflict subject. An output cannot add free-form shell, Python, SQL, operator paths or arbitrary graph effects.

### 5.5 Decisions, assessments and dispatch

`InvestigationDecision` is immutable: investigation ID/revision, complete input fingerprint and reference snapshot, strategy digests, hypotheses, all considered actions with exclusion reasons, selected action or stop reason, and timestamp. Store the normalized observation snapshot with it, under the input cap, so the reasoning can be replayed.

`HypothesisAssessment` is immutable: hypothesis key, action key, assessment-rule ref/digest, verdict, typed measured values, evidence refs, evaluation scope and limitations. Freshness is a projection over dependencies; do not rewrite a past verdict to `stale`.

One dispatch row per semantic action key stores `queued | running | succeeded | failed | cancelled`, downstream run/study/decision IDs, reservation and terminal result refs. A computation failure is separate from a scientifically inconclusive result. Hypotheses and assessments refer to existing score/check artifacts, rather than copying full tables.

Add three indexed storage groups through the next available SQLite migration: `investigations`, `investigation_decisions` (including assessment payloads from that cycle), and `investigation_actions`. Reuse `audit_events`. Enforce one active action per investigation; unique `(investigation_id, action_key)`; and unique command idempotency keys with request bodies. Do not hardcode a migration number before implementation.

Assessments have a semantic key comprising hypothesis, action result artifact hashes and assessment-rule digest. The action row records which decision committed its assessment; transaction checks prevent a later cycle from appending the same assessment twice. No assessment function runs against partial score tables.

## 6. Strategy packages and executable knowledge

Add `methodology/supervised/strategies/<name>/strategy.yaml` and `strategy.py`. Extend the existing methodology catalog loader with a separate strategy collection. Existing one-rule-per-operator routing remains unchanged: several strategies may suggest experiments, while Rust chooses one action at a time.

Manifest fields are limited to fields the loader or tests use:

```yaml
id: supervised.preparation_diagnosis@1.0.0
status: active
tasks: [classification, regression]
reads:
  - question.target
  - profile.missing_share
  - selection.outcome
  - history.preparation_assessments
experiments: [preparation_comparison@1.0.0]
settings_schema: {type: object, additionalProperties: false}
provenance: {source: "ADR-0050", reviewer: "required before activation"}
examples:
  - given: no_current_comparison
    proposes: compare_preparation
  - given: comparison_without_clear_improvement
    assesses: inconclusive
```

This is an illustrative manifest; schema names and fixture references must be validated at implementation. `reads` entries resolve against a typed catalog with scopes and origin requirements. `experiments` resolve to registered, implemented builders. Examples name fixture files containing full inputs and expected semantic outputs. `provenance` supplies source links and the actual named reviewer displayed with the strategy; placeholders fail activation. Unknown facts, unused fields, undeclared reads/actions and missing result branches fail pack tests. Draft strategies never run.

Each registered experiment has one builder identifier, supported tasks/input scopes, parameter schema, expected outputs and cost-counting function. The first two builders are the existing model comparison and preparation comparison. A diagnostic later follows the same normal-operator path. Do not build a generic template language.

Python owns scientific conditions and interpretation. Rust owns only structural admissibility and mechanical priority/conflict rules. Thresholds are explicit strategy settings pinned before the relevant experiment; changing one changes the fingerprint and exposes the revision history.

## 7. Reasoning, arbitration and termination

One cycle:

1. Read the selected investigation revision and completed dependency records in a consistent snapshot.
2. Validate scope and evidence freshness; exclude final-evaluation evidence from strategy inputs.
3. Assess newly completed experiments using their originally pinned assessment rules, observation snapshot and hypotheses. Newly observed facts do not rewrite the original test criterion.
4. Run applicable strategies on declared inputs; collect every candidate and missing prerequisite.
5. Reject candidates with invalid references, unsupported capabilities, unmet prerequisites, exhausted budgets or repeated semantic keys.
6. Select by priority class, then pinned strategy order, then stable subject/action key. Persist the whole decision before dispatch.
7. In manual mode show the selected action; in bounded mode dispatch an authorized experiment. Reconcile again when it ends.

Priority classes, highest first: integrity failure requiring attention; missing required context; necessary diagnostic; baseline/standard comparison; hypothesis-directed comparison or tuning; review/apply; stop. A running action prevents another computation. Blocking requirements suppress dependent experiments; unrelated findings remain visible. No learned ranking or invented numerical “value of information” score is required.

Scientific compatibility is decided by strategies and protocol validators. Rust resolves scheduling conflicts, not disagreement about scientific truth. If strategies propose incompatible values for a required domain fact, request a fact; do not settle the fact by strategy order. All rejected alternatives retain reasons.

Action key:

```text
hash(investigation_id, experiment/strategy implementation digest,
     hypothesis/subject, pinned inputs and scope,
     canonical params, search space, seed, protocol)
```

Exclude timestamps, decision IDs, changing budget remainder and cosmetic explanations. A parent decision change alone must not permit repeating identical work. Canonical JSON has sorted object keys; semantically unordered collections are sorted; NaN/Infinity are refused. The input fingerprint additionally includes history and policy revisions, so new evidence can trigger reassessment without rerunning the same experiment.

Stop reasons are typed: `development_criteria_met`, `no_supported_candidate`, `inconclusive`, `budget_exhausted`, `strategy_coverage_exhausted`, `user_stopped`. `development_criteria_met` requires all configured machine-checkable development criteria; prose acceptance criteria remain `requires_review`. None means production-ready or scientifically proven.

Invalid data, missing facts and execution failure usually pause/request input; they are not scientific stop reasons. Stable duplicate-action suppression plus finite candidates, maximum rounds and budget gives termination. Manual retries are explicitly recorded and capped; they cannot reset investigation limits. Numerical equality within a specified tolerance has a deterministic tie rule.

## 8. Experiment reuse and required Study changes

Extend Study through a versioned contract migration rather than calling every experiment a model search:

- `kind: model | preparation`, defaulting to model when reading old v1 records.
- `strategy: fixed | grid | random`; fixed selects existing alternatives without parameter search.
- Optional investigation/action references and immutable evaluation-scope digest.
- Every kind has max trials and wall time. Fixed candidate count includes its baseline; model search counts every instantiated cross-validation node.
- Preparation studies use `preparation_comparison` and its existing limitations: one preparation decision, one downstream model, compatible fold-local transforms, unchanged rows and target. No joint preprocessing/model search in v1.

Keep Trial as a projection of graph steps/attempts. Keep SelectionDecision as the within-experiment selection result. Add typed `outcome` (winner, no baseline improvement, guardrail failure) and `evaluation_role: development` to new selection records. Existing records lacking structured reasons must be re-assessed from validated numeric fields or treated as unsupported; never parse their prose reason.

Current `select_model` refuses guardrails for preparation reference comparisons. Preparation v1 therefore assesses only its registered metric-improvement hypothesis and cannot claim to satisfy recall guardrails. After a preparation change, a new model study evaluates the full model criteria. Do not silently broaden an existing statistical function's meaning.

Registered study builders share current `compare.rs` and Python numerical implementations. Extract reusable application functions from the HTTP handlers as needed; controller and endpoints call the same functions. Mutations are never implemented by calling localhost HTTP from inside the server.

Current unbudgeted, UI-triggered automatic comparisons must be disabled for investigation-managed branches or routed through the same recorded budget reservation. Opening Atlas or Experiments must not start an unaccounted experiment.

## 9. Data identity and scientific validity

### 9.1 Freeze actual inputs

A pipeline version does not freeze the file its source node reads. Pin source and train artifacts before a loop starts; do not keep reopening a mutable CSV path in each study.

The current scheduler resolves inputs only from upstream attempts. Add optional `PipelineVersion.artifact_bindings`, each containing an `artifact_id` and destination `PortRef`. An input must have exactly one upstream edge or artifact binding. The API resolves artifact ownership, content hash and declared kind; the compiler receives that validated metadata to check port compatibility. The scheduler resolves the same immutable artifact at dispatch and passes it through the existing worker input/hash-verification path. Bound input hashes enter the existing cache key. Reject missing, foreign-project, wrong-kind and double-bound inputs. Domain records hold artifact IDs, never storage paths.

The comparison builder uses the base flow to derive fold-local preparation and split semantics, then binds its cross-validation inputs directly to the pinned training artifact. It omits the original file-source/split execution prefix from the comparison graph. Gate B receives the bound artifact's split provenance and purpose so it can still verify scope without seeing a split node. This is one explicit compiler/scheduler input-binding extension, not an existing feature or a new scheduler. It also permits ordinary registered diagnostics to consume frozen artifacts without a special source operator.

Use a compiler-checked prefix of the existing flow to produce source/split artifacts when absent. It ends at the split; it must not execute a model evaluator. Record its run and charge its wall time. Only supported registered source/split/preparation operators are admitted for bounded execution. Opaque code with undeclared reads requires manual work and is reported as uncovered.

Proposal observations currently discard the identity of the train artifact used to profile a node. Extend the observation assembly to retain it, attach it to `MethodologyEvidence`, and include all observed values and source digests in the proposal fingerprint. Freshness must be checked transactionally when applying an action; comparing only pipeline descendants is insufficient.

A new run with identical content need not invalidate evidence solely because the artifact ID differs: use content hash plus split/protocol identity and retain both provenance links. Missing input provenance produces `unverified`, not current. A file changed outside the app is discovered on explicit reimport; no filesystem watcher or detection guarantee is implied.

### 9.2 Development and final assessment

Repeatedly adapting experiments to validation results can overfit the selection process. Nested hyperparameter search within each Study does not validate an entire adaptive sequence that consumes its outer scores. Therefore every score used to choose the next action is development evidence. Per-study p-values are not a guarantee for the whole investigation. See [Cawley and Talbot](https://jmlr.csail.mit.edu/beta/papers/v11/cawley10a.html) and [scikit-learn's validation guidance](https://scikit-learn.org/stable/modules/cross_validation.html).

The controller never consumes final test labels, final metrics or findings derived from them. Scope labels are assigned and checked by the platform, not by Python strategy assertions. Comparison graphs must depend only on pinned development inputs. Close the existing study Gate B coverage gap before bounded execution ships. Test an intentionally miswired study and ensure it is rejected even when no normal evaluator node is present.

For a final estimate, freeze the chosen full pipeline and assess on untouched data separately. V1 ends at a development recommendation; automated final evaluation and a validated-complete status are deferred. Existing manually scored holdouts are marked exposed. Unknown prior exposure remains unverified. Changing seed, proposal, investigation ID or branch must not reset exposure history for the same source population/split identity.

Record every development look, including failed and partial studies. Group relevant history across proposals and branches by data/split/protocol identity. Do not rank scores from incompatible protocols. Existing fixed-fold comparison limitations remain visible; the loop does not turn an approximate test into a universal scientific guarantee.

These are guarantees for managed registered execution. The current local Python runtime is not a sandbox against a user deliberately reading files outside the managed path. Do not label arbitrary notebook activity certified or holdout-unexposed.

## 10. Durable controller, budgets and concurrency

Modes:

- `manual`: persist the next decision and wait for a command.
- `bounded`: execute permitted diagnostics/studies until waiting, stopping or budget exhaustion. Graph Apply and semantic fact confirmation still require the user's action. Approval of bounded mode is a concrete policy with allowed experiments and limits.

Budgets: maximum rounds, experiments, total planned trials, absolute deadline and per-experiment wall time. Caps are validated before creation. No default unlimited value. V1 reserves planned trials once per action, including baseline and cache hits; this measures admitted search size, not billed CPU. Attempt retries remain bounded by the existing scheduler policy and consume elapsed time. Completed reservations are not refunded to enable more selection attempts.

The effective execution deadline is the minimum of investigation and study deadlines. As in current studies, an in-flight attempt may finish after it; overshoot is bounded by the operator timeout. Pause/resume never resets the absolute deadline. Expanding a budget requires an explicit audited policy revision. Partial studies retain evidence and make no selection.

Transaction protocol:

1. Check expected investigation revision, active branch, evidence fingerprint and remaining budget.
2. Insert the immutable decision, unique action row and reservation; advance revision atomically.
3. Dispatch using the action's deterministic idempotency key through the shared application service. Link its durable run/study in the same creation transaction where possible; otherwise re-dispatch by the same key to discover the existing result after a crash.
4. Observe the durable run, then atomically record outcome/assessment and release the active-action slot. Only this transition enables another cycle.

An action row records intent and linkage; the existing scheduler owns attempts, leases, retries and execution. The controller does not lease numerical work. Two concurrent advance requests cannot reserve or start two actions. Replay with the same key/body returns the previous response; a changed body returns 409.

On API startup reconcile queued actions and linked running studies, using existing run-recovery primitives. A dispatch claim must have transactional ownership and expiry so two processes cannot both drive a run; verify or extend the existing mechanism before claiming restart safety. Recover the same run after expired attempt ownership, never create a replacement study merely because an API response was lost. A local reconciliation task checks existing durable statuses; no message broker or SSE is required.

State transitions: preparing -> ready when input pinning commits; preparing -> paused on preparation failure; ready -> running on claimed computation; running -> ready on committed result; ready -> awaiting_input/awaiting_apply when human action is needed; ready -> stopped on a typed conclusion; running -> paused on exhausted execution retries; any nonterminal state -> paused on user pause. Stop during a run disables further dispatch, requests existing cancellation and retains late outputs as historical evidence. Restart must preserve that intent. A stopped investigation resumes only through an explicit policy/context revision with prior evidence intact.

The decision records the revision it observed. Its action is issued against the revision created by committing that decision; manual execution checks this issued revision and current dependencies. This avoids treating the controller's own decision commit as a stale action. While an action runs, pause/stop and context changes invalidate future dispatch but do not erase its original assessment scope. Results from an old scope remain historical and cannot update the new scope's recommendation.

## 11. API and stale actions

Proposed routes; request/response contracts live in the canonical schema source:

| Route | Behavior |
| --- | --- |
| `POST /investigations` | Create from a linked question/flow, enabled strategies and explicit policy; establish artifact pinning before ready |
| `GET /investigations/{id}` | Read current state and derived evidence summary |
| `GET /investigations/{id}/decisions?before=…&limit=…` | Paginated immutable decisions and assessments |
| `POST /investigations/{id}/advance` | With expected revision/idempotency key: assess new results and propose next action; dispatch only in bounded mode |
| `POST /investigations/{id}/actions/{key}/execute` | Execute a recorded permitted action in manual mode; revalidate revision/scope and authorization |
| `POST /investigations/{id}/context` | Explicitly select an immutable question/flow revision and, if needed, new pinned data; mark dependent conclusions stale |
| `POST /investigations/{id}/control` | Pause, resume, stop or revise budget with revision check and audit |

GET requests never evaluate Python, create a proposal, or start compute. Creating or advancing an investigation is explicit. Existing methodology Apply remains the graph mutation route; the shared application service also updates the managed investigation's branch and audit atomically when an investigation action is supplied. An external hand edit pauses automation until `/context` selects it. Side comparison versions never become the active branch.

Typed errors include `stale_revision`, `stale_evidence`, `scope_mismatch`, `unsupported_experiment`, `unknown_fact`, `conflicted_fact`, `context_limit`, `budget_exhausted`, `idempotency_conflict` and `incompatible_protocol`. An old action can be inspected but cannot execute after its dependencies changed.

## 12. Worked deterministic strategy

First strategy: `supervised.model_diagnosis`, using the existing shortlist, finite model search and classification recall guardrail where configured.

| Input condition | Assessment or next action | What it does not establish |
| --- | --- | --- |
| Target is inferred or missing | Request confirmed target; no model experiment | The column name alone establishes the objective |
| No scoped baseline comparison exists | Fixed model study, same folds and declared guardrails | A high training score demonstrates generalization |
| Some candidate beats the baseline but fails recall; untried search space exists | Hypothesis: the registered tuning procedure produces an eligible candidate under this development protocol; run bounded nested search | Threshold, missingness or imbalance is necessarily the cause |
| Tuned study returns eligible winner | Hypothesis supported in this development scope; propose Apply | Whole-loop statistical significance or deployment readiness |
| No candidate beats baseline and no applicable diagnostic is registered | Stop `no_supported_candidate`, retaining open explanations | There is no signal in the population |
| Search exhausted without eligible winner | Assessment inconclusive; stop or another implemented strategy proposes a different experiment | Unlimited tuning will solve the problem |
| Budget ends mid-study | Preserve partial evidence; stop `budget_exhausted` without winner | Fast-finishing candidates are superior |

Second strategy: `supervised.preparation_diagnosis`. If current training profiles show missingness, an eligible preparation step exists and the model remains fixed, propose a registered preparation comparison. Its hypothesis and practical threshold are fixed before scores arrive. If an alternative improves by the required amount under the registered comparison criterion, propose Apply; otherwise record inconclusive and retain the reference. Applying it invalidates model-selection conclusions for the old pipeline and triggers a fresh model study on the updated pipeline.

Use different fixtures for success, no improvement and insufficient data. A threshold for practical improvement is supplied by policy and checked with the existing comparison result; it is not learned from the winning score. No scientific support is inferred merely from a rule firing.

The visible result is: “We compared mean and median filling for this fixed model because these training columns have gaps. The experiment did not establish the required improvement. Keep the reference and continue to the model study.” Every sentence links to rule, inputs, experiment or assessment.

A nested study's outer scores assess the tuning procedure; settings may differ across outer folds. The settings selected on all development data are recorded for Apply, but their inner score is not a fresh performance estimate for that final configuration. The assessment must preserve this distinction from the existing Study contract.

## 13. UI

Extend Atlas with five linked sections: objective/context; current hypothesis; experiment and budget; assessment with supporting evidence and limitations; next action. Show considered alternatives behind a detail control. Use reason text from recorded decisions, not generated explanations.

Buttons use the same API as CLI/SDK clients. “Run within budget” shows permitted experiment kinds and limits. “Apply” previews the exact graph diff. A question that needs domain knowledge cannot be answered by accepting a statistical inference. Existing Flow, Parameters, Checks and Experiments remain the detailed work surfaces.

Show execution and scientific outcome separately: `Run succeeded; hypothesis inconclusive` is a normal state. Show stale evidence with the changed dependency. Never render a global percentage that suggests a pipeline is scientifically correct because most checks passed.

## 14. Delivery slices and source changes

| Slice | Changes | Exit proof |
| --- | --- | --- |
| 1. Evidence boundary | API observation provenance, proposal fingerprint/Apply checks, artifact input bindings in pipeline schema/compiler/scheduler, study input validation in methodology checks | Changed source cannot silently change a pinned experiment; miswired holdout input is rejected |
| 2. Pure strategies | Canonical contracts; `strategy.py` proposal/assessment functions; catalog validation and worker protocol adapter | Identical observations yield identical actions; unknown/conflicted facts and failed results have explicit branches |
| 3. Budgeted experiments | `study.schema.json` migration, `compare.rs`, shared API study functions, typed selection outcomes and preparation studies | Fixed/model-search/preparation experiments use the existing scheduler with budgets and protocol checks |
| 4. Durable loop | Investigation store migration, `crates/sprisk-api/src/investigations.rs`, mechanical action arbitration in `sprisk-methodology`, startup reconciliation | Two-result adaptive sequence completes; races/restart do not duplicate work or reset budget |
| 5. Workbench proof | `QuestionLedger`/new Atlas view, API hooks, links to Studies/Checks/Parameters | Reopen reconstructs hypothesis -> experiment -> assessment -> next action; no compute on view |

Each slice includes its public-interface tests before implementation. There is no claim that these are already complete. Schema changes preserve v1 readers or use explicit v2 documents with conversion at the boundary. Never rewrite old immutable evidence. Keep old operator versions available for replay; if their environment is unavailable, report `replay_unavailable` instead of substituting new code.

The core implementation is complete when slices 1–5 pass. Adding more registered strategies then extends scientific coverage without changing the controller's execution semantics.

## 15. Acceptance suite

| ID | Scenario | Required result |
| --- | --- | --- |
| INV-01 | Same canonical observation, strategy code and settings evaluated twice | Same hypotheses, proposed actions, assessments and reasons |
| INV-02 | Two successful experiments with different valid result fixtures | Different next actions selected by scientific evidence, not step number |
| INV-03 | Missingness diagnostic versus guardrail-failure diagnostic on supported flows | Preparation comparison versus model search; each names its testable proposition |
| INV-04 | Unknown/inferred target or conflicted entity semantics | Request fact; no fabricated target and no downstream compute |
| INV-05 | Study succeeds with no clear improvement | Inconclusive assessment; no equivalence/causal claim |
| INV-06 | Candidate violates guardrail despite better primary metric | No eligible winner from that candidate |
| INV-07 | Wrong fold identities, source hash, target or protocol | Refuse assessment/selection and name mismatch |
| INV-08 | Source reimport changes content; old proposal/action is executed | Stale rejection; no graph mutation or budget charge; old evidence remains inspectable |
| INV-09 | Different artifact IDs, same pinned content and scope | Reuse allowed with exact provenance retained |
| INV-10 | Holdout input wired to study; graph lacks conventional evaluator | Gate B rejects; final metrics never reach strategy context |
| INV-11 | Same experiment proposed after new timestamp/decision or new view | Semantic key suppresses repeat; GET starts nothing |
| INV-12 | Concurrent advance/execute requests and lost response | One reservation, one downstream run/study; changed idempotency payload conflicts |
| INV-13 | Crash before dispatch, after study creation or before result acknowledgment | Recovery links same work and records assessment once; deadlines persist |
| INV-14 | Budget exhaustion, worker failure, user pause/stop | Partial artifacts retained; no unsupported winner or further unauthorized action |
| INV-15 | Graph Apply from another client while action awaits execution | Revision/scope check refuses action; branch changes explicitly |
| INV-16 | New browser session and server restart | Same recorded scientific progress, evidence links and next action |
| INV-17 | Free-text acceptance criterion and development winner | Requires review; never automatic “validated” |
| INV-18 | New strategy with only pack files within an existing experiment kind | Loads, proposes and assesses without compiler/scheduler/UI edits |
| INV-19 | Old operator or strategy implementation unavailable | Replay unavailable is explicit; no silent version replacement |
| INV-20 | Artifact binding references foreign, missing or wrong-kind data, or duplicates an edge | Reject before dispatch; valid binding participates in scope checks and cache identity |

Use existing German-credit and penguins fixtures for real execution. Use small deterministic synthetic fixtures for boundaries and injected results for state-machine tests. Do not require a real dataset always to produce a statistically significant winner. Test timing with the existing fake clock; no sleeps or network calls.

## 16. Deferred capabilities

Record these in the backlog: final-evaluation access ledger and frozen-candidate protocol; new diagnostics for thresholding, calibration and learning curves; joint preprocessing/model search with appropriate evaluation; continuous/adaptive parameter search; domain strategies for forecasting, causal inference and other modalities; hosted execution and third-party pack isolation. None is required to implement the first deterministic investigation loop, and none may be advertised as supported because its name appears here.
