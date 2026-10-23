# ADR-0054: Scientific rules drive a deterministic investigation loop

Status: Proposed
Date: 2026-10-22
Arch doc sections: §4, §7, §8, §11, §21. Supersedes ADR-0053; extends ADR-0042, ADR-0045, ADR-0050 and ADR-0052.

## Context

Sprisk already proposes method choices, executes typed pipelines and compares candidates. It lacks a persistent loop that uses the measured results to choose the next experiment and records what that experiment established. The necessary first strategies can be expressed as explicit scientific rules.

## Decision

- Adopt the [deterministic investigation specification](../design/deterministic-investigation-loop.md). No LLM is part of its decision or execution path.
- Keep scientific assessment and experiment proposals in pure Python functions within methodology packs. Rust validates applicability inputs, adjudicates authorized actions, reserves budgets and dispatches existing commands.
- Preserve existing node rules. Add registered investigation strategies with bounded observations, typed action proposals and executable examples. Manifest metadata contains no executable rule language.
- Record immutable hypothesis assessments and action decisions. A small mutable `Investigation` record holds the current branch, revision, budget and lifecycle state.
- Keep `PipelineVersion`, `Study`, `Run`, `Attempt` and `Artifact` as the only computation path. Extend study construction where needed; do not add another scheduler.
- Treat evidence used to adapt the loop as development evidence. Final assessment is separate, with a frozen candidate and recorded holdout access.
- Make Atlas a projection of recorded scientific progress. It shows why an experiment was chosen, what happened and what the evidence supports.

## Alternatives considered

- Read-only next-step checklist: does not learn from experiment results.
- LLM-managed scientific decisions: unnecessary for known rules and harder to reproduce.
- A new workflow DSL or second execution graph: duplicates existing capabilities.

## Consequences (good and bad)

- Good: reproducible scientific reasoning and execution, with explicit unknown and inconclusive outcomes.
- Good: current operators, studies, checks and graph effects remain reusable.
- Bad: durable coordination, data pinning and evaluation-scope enforcement need implementation; current APIs alone do not provide the complete guarantee.
- Bad: the engine can investigate only hypotheses supported by implemented strategies. Missing coverage is reported explicitly.

## Validation (how we will know it was right)

Complete the spec's acceptance suite: diagnostic-dependent branching, bounded termination, incompatible-evidence rejection, stale-action rejection, restart recovery, no duplicate dispatch and holdout exclusion. Run the first slice on existing tabular fixtures without an AI provider.

## Architecture reconciliation

On implementation acceptance, update v2 §4/§7 with investigation state and evidence scope; §8 with strategy proposal/assessment functions; §11 with development-versus-final evaluation and study extensions; §21 with the gated delivery slices. Record implemented coverage in the integration map only after its acceptance tests pass.
