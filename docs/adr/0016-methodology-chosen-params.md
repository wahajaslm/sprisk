# ADR-0016: Params chosen by methodology, shown and confirmed in the UI

Status: Proposed
Date: 2026-10-16
Arch doc sections: §4, §5, §7, §8

## Context

- Methodology rules will pick operator params (e.g. "date column present → `temporal_split`, `time_column: order_date`").
- Users must see each pick, why it was made, and the alternatives, then confirm or change it.
- `PipelineVersion` is immutable and holds plain param values. It must stay that way (rule 5).
- Checks and the UI need to know what a param *means* (target, feature, time, group), not just its JSON type.

## Decision

1. **Manifests describe params.** `params_schema` stays JSON Schema. Use standard `title`, `description`, `default` for display.
2. **Column roles.** A param that names columns carries `x-sprisk-column: { port: <input port>, role: target | feature | time | group | id }`. The UI shows a column picker from that port's profile. Gate B checks read the role.
3. **Pipelines hold values only.** Node params remain plain values. Changing one creates a new `PipelineVersion`.
4. **`ParamChoice` records why.** A new immutable entity, one per methodology-set param:
   - `pipeline_version_id`, `node_id`, `param` (JSON Pointer), `value`
   - `origin`: `explicit | inferred | measured | confirmed`
   - `decided_by`: rule id and version (e.g. `supervised.chronology@1`), or the user
   - `rationale`, cited artifacts (e.g. the profile)
   - `alternatives`: other values or operators, each with the reason it was not chosen
5. **Decision graph link.** `ParamChoice` is a decision-graph node (§4). An override that makes a Gate B check FAIL needs an acknowledged `Assumption`.

## Alternatives considered

- Store origin inside node params. Rejected: mixes provenance into values and changes cache keys.
- A separate UI-only form spec. Rejected: a second source of truth next to `params_schema`.
- Infer column meaning from param names. Rejected: fragile; third-party operators would not follow it.

## Consequences

- Good: one schema drives validation, forms and checks. New operators get forms for free.
- Good: every methodology pick is traceable and reviewable.
- Bad: `x-sprisk-column` is a custom keyword; jsonschema validators ignore it, so the Rust registry must check it.
- Bad: one more entity and contract to maintain.

## Validation

- A UI form for every core operator renders from its manifest alone.
- Each methodology-set param in a test pipeline has exactly one `ParamChoice` with a rule id.
- Overriding a chronology pick to `random_split` yields FAIL until an `Assumption` is acknowledged (§15.11).

## Arch doc edits needed

- §4: add `ParamChoice` to the entity table and to the decision graph.
- §5: name `x-sprisk-column` under "Data semantics".

Target milestone: M2 (UI form, roles) and M3 (rules writing `ParamChoice`). Not built in M1.
