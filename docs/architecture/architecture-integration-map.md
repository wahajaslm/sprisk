# Sprisk core workbench integration map

**Status:** M0 repository reconciliation, 19 October 2026  
**Target:** `sprisk-enterprise-platform-design-v2.md`  
**Scope:** local core workbench only; external auth, hosted storage and deployment integrations are deferred.

## Product interaction to preserve

The first methodology interaction is part of the normal flow. It is not a new top-level tab and not an unrelated panel above the canvas.

```text
select Split node
  -> inspector explains the active methodological decision
  -> user sees applicable alternatives and supporting facts
  -> Preview shows the exact graph change
  -> Apply creates one immutable PipelineVersion
  -> Run executes it
  -> Checks verifies the selected design and links back to its rule/evidence
  -> Experiments compares the decision, checks and results with another run
```

The nine existing inspector docks remain. The selected node's normal inspector provides the decision context. `Checks` is the verification half of the same methodology rule; it must display the rule, subject, evidence/coverage and relation to the selected decision. A later advanced Methodology Workflow may project decisions and requirements across the investigation, but it is not the first implementation and is never a second executable graph.

## Actual repository map

| Existing source path | Actual responsibility/contract | Decision | Gap before first slice | Acceptance evidence |
|---|---|---|---|---|
| `contracts/schemas/question_version.schema.json` | Defines question, task, target, unit and time facts | Extend/reuse | Contract exists but has no Rust persistence/API or workbench editor; pipelines do not reference it | A flow resolves one exact question revision; inferred facts cannot authorize a choice |
| `contracts/schemas/pipeline_version.schema.json` | Canonical immutable executable graph | Reuse | No link to question/methodology decision provenance | Applied choice creates one child version and records its decision reference |
| `contracts/schemas/methodology_check.schema.json` | Gate B verdict with rule ref and cited nodes | Extend | Missing phase, subject, scope, evidence, policy version and coverage required by v2; no decision link | Check UI can answer what was checked, against which choice/evidence, and what remains unverified |
| `crates/sprisk-graph/src/lib.rs` | Authoritative graph compilation and node/port checks | Reuse | No typed EffectPlan/diff admission object | Preview and Apply compile through this same compiler |
| `crates/sprisk-api/src/lib.rs:create_pipeline_version` | Compiles and stores manually supplied graph versions | Reuse behind Apply | No proposal/preview/apply commands, revision fingerprint or idempotency record | Stale Apply fails; retry returns the same committed version |
| `crates/sprisk-store/src/lib.rs` and SQLite migrations | Pipelines, runs, attempts, artifacts, notebooks | Extend | No question, evidence, decision proposal/effect plan, or decision-to-version tables | Restart preserves question, proposal, decision and check links |
| `crates/sprisk-scheduler/src/run.rs` | Runs Gate B first as a worker attempt and validates checks | Reuse/extend | Gate receives graph/operators only; it cannot see question facts or a selected decision | Gate evaluates the exact question + graph + decision revisions |
| `methodology/supervised/src/sprisk_supervised/pack.py` | Runs `split_leakage` and `code_leakage` | Reuse as verification | This is a check pack, not a methodology resolver; it produces no alternatives/effect plan | Existing hand edits and generated choices receive the same checks |
| `methodology/supervised/src/sprisk_supervised/split_leakage.py` | Detects fitting/selection leakage around holdout ports | Reuse | Does not validate whether random vs temporal/entity split matches declared semantics | Corresponding design rule and verification rule share stable rule identity |
| `plugins/validation/operators/random_split/manifest.yaml` | Registered random split | Reuse | No semantic applicability metadata | Available only when the question does not require temporal/entity separation |
| `plugins/validation/operators/temporal_split/manifest.yaml` | Registered temporal split | Reuse | No resolver binding; no confirmed time fact path | Confirmed time column can propose this operator and Gate B verifies chronology |
| `plugins/validation` | Split execution | Extend | Group/entity split is absent | Repeated entities can be separated without custom code |
| `apps/web/src/views/inspector/ParametersTab.tsx` | Edits raw operator parameters and immediately saves/runs | Keep for advanced/manual edits | It does not express decision, alternatives, evidence, reason, Preview or Apply | Split inspector uses human choices; raw params remain available as advanced settings |
| `apps/web/src/views/inspector/ChecksTab.tsx` | Shows Gate B checks citing the selected node | Extend | Generic verdict cards hide rule identity and do not connect to a choice/evidence/coverage | Selected Split shows its design decision and matching verification together |
| `apps/web/src/views/Experiments.tsx` | Compares run settings, metrics and checks | Extend | Comparison knows parameter differences, not decision identity/reason/evidence | Comparison explains “random vs temporal/entity,” evidence and verdict changes |
| `apps/web/src/views/FlowCanvas.tsx` | Projection/editor of the canonical graph | Reuse | None for a first inline decision; do not add a methodology graph here | Applied effects appear as ordinary graph nodes/edges |
| `apps/web/src/workbench/*` | Nine inspector docks and selection context | Reuse | No investigation/question context in selection | Node inspector resolves context from persisted flow linkage |

## Required implementation order

1. Persist and expose `QuestionVersion`, then bind a pipeline version to the exact question revision it answers.
2. Define the smallest shared contracts for methodology rule identity, scoped evidence, `DecisionProposal`, alternative, `EffectPlan` and applied `Decision`.
3. Implement the supervised split resolver using confirmed question facts and measured profile evidence. Add entity/group split before offering that alternative.
4. Add Preview and atomic, idempotent Apply in Rust. Effects compile through the existing graph compiler and create the normal child `PipelineVersion`.
5. Put the split choice in the selected Split node's inspector. Show current choice, recommendation/applicability, alternatives, missing facts, Why, Preview and Apply. Keep operator IDs and manifests out of the normal path.
6. Extend Gate B input and `MethodologyCheck` so verification cites the same rule, decision, scope and evidence. Rework `Checks` to show design and verification as one chain.
7. Extend Experiments to compare decision identities/reasons alongside metrics and checks.

## First vertical slice

**Decision:** How should observations be separated?  
**Alternatives:** random; by time when a time fact is confirmed; by entity when a unit/entity fact and suitable column are confirmed.  
**Evidence:** question revision plus bounded profile facts such as repeated values and physical column types. Observations do not silently become semantic facts.  
**Effect:** replace/configure the selected split through a typed graph effect and show the edge/node diff.  
**Verification:** split applicability plus leakage/chronology/entity-overlap checks, all linked to the applied decision.

This slice is complete only when a user can reopen the workbench and trace:

```text
question fact -> rule applicability -> selected alternative -> graph effect
              -> pipeline version -> run -> methodology check -> experiment comparison
```

## Explicitly deferred

- Missing-value decision automation and cleaning-pack UI, until the split decision path works.
- A standalone Decisions tab or default second methodology canvas.
- LLM planning.
- External identity, managed database/object storage, remote workers and hosted deployment.
- Claims of runtime fit-scope certification until runtime row evidence exists.
