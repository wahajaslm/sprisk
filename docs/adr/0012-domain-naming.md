# ADR-0012: Consistent domain naming

Status: Accepted
Date: 2026-10-15
Arch doc sections: §2A, §4, §5, §9, §11

## Context

Revision 1.1 of the architecture doc used different words for the same idea:
- `DatasetVersion` vs `PipelineRevision` for immutable snapshots.
- `PipelineSpec` and `PipelineRevision` for one concept.
- "job", "step" and "attempt" for one unit of work.
- Suffixes that add nothing: `Spec`, `Definition`.

Every name lands in schemas, three languages, the database and the UI. Fixing it later is expensive.

## Decision

Entities are plain nouns. An immutable snapshot is `<Entity>Version`. No `Spec`, `Definition` or `Info` suffixes. "Job" is not a domain term.

| Old | New |
| --- | --- |
| `OperatorDefinition` | `Operator` |
| `PipelineSpec`, `PipelineRevision` | `Pipeline`, `PipelineVersion` |
| `ExecutionRun` | `Run` |
| *(unnamed)* | `Step` (one node in a run) |
| `StepAttempt` | `Attempt` |
| `QuestionSpec` | `Question`, `QuestionVersion` |
| `ExperimentSpec` | `ExperimentStudy` protocol |
| `ViewTypeDefinition` | `ViewType` |
| `VisualizationSpec` | `Visualization` |
| `WorkbenchViewRegistry` | `ViewRegistry` |
| `LeaseJob` (worker protocol) | `LeaseAttempt` |

## Alternatives considered

- Keep the 1.1 names. Rejected: the inconsistency would spread into every layer.
- `Revision` everywhere instead of `Version`. Rejected: `DatasetVersion` and operator versions already use `Version`.

## Consequences

- Architecture doc updated to revision 1.2.
- Schema `$defs/StepAttemptId` renamed to `AttemptId`. The wire field `producer_attempt_id` is unchanged.
- External standards keep their own terms (OpenLineage "job").

## Validation

`git grep -E "Spec\b|Definition\b|StepAttempt|ExecutionRun|LeaseJob"` finds no domain uses.
