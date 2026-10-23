# ADR-0053: Investigation state and next-action projection

Status: Superseded by ADR-0054
Date: 2026-10-22
Arch doc sections: §7, §8, §11, §21.

## Context

The initial proposal assembled questions, decisions, checks and studies into a read-only Atlas projection with a prioritized next action. It described coordination and presentation, but did not specify how diagnostic results change scientific hypotheses or select subsequent experiments.

## Decision

[ADR-0054](0054-deterministic-investigation-loop.md) replaces this proposal. Its [implementation specification](../design/deterministic-investigation-loop.md) defines a deterministic loop driven by scientific rules, scoped observations, registered experiments and recorded assessments.

The Atlas remains a derived view of that loop. Scientific reasoning belongs to Python methodology packs. Rust owns durable control, authorization and execution through the existing compiler and scheduler. No LLM is required to propose, assess or select an experiment.

## Alternatives considered

- Ship only the read projection: useful for navigation, insufficient for adaptive investigation.
- Add an LLM planner to supply the missing reasoning: unnecessary for the explicit methodological knowledge in scope.

## Consequences

The replacement requires durable investigation and decision records; the earlier claim that the complete loop needs only one GET endpoint and no storage changes is withdrawn. Existing graph, study, attempt and artifact infrastructure remains the execution foundation.

## Validation

The replacement must demonstrate two different next experiments from two different measured results, and preserve the reasoning and evidence across restart. A checklist or fixed wizard alone does not meet that requirement.
