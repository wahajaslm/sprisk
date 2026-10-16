# ADR-0017: Gate B runs as a worker attempt

Status: Accepted
Date: 2026-10-16
Arch doc sections: §8, §9, §11

## Context

- Gate B rules are Python (ADR-0006, ADR-0015). The scheduler that must block on them is Rust.
- Rust already reaches Python one way: the worker protocol, with leases, retries, staging and audit.
- A second path (a direct subprocess call) would be unleased, unaudited, and a second protocol to maintain.

## Decision

1. Before the first pipeline step, the scheduler runs one extra attempt with node id `gate_b`.
2. Its operator is a methodology pack entrypoint, e.g. `sprisk.methodology.supervised@1.0.0`, declared by a manifest under `methodology/<pack>/`. These manifests are loaded by the worker only; they are **not** in the pipeline registry, so no pipeline can use them as a node.
3. Its one input is the `PipelineVersion` JSON, committed as an artifact. The worker reads operator manifests from its plugins root.
4. Its one output, port `checks`, is a JSON array of `MethodologyCheck` records, committed like any artifact.
5. The scheduler parses the array through the contract. Any `fail` verdict ends the run as `failed` before any pipeline step runs. Warnings do not block.

## Alternatives considered

- Direct subprocess call from Rust. Rejected: second, unaudited path into Python.
- Gate B as a normal pipeline node. Rejected: users could remove or rewire it.
- Gate B inside the API process. Rejected: rules are Python.

## Consequences

- Good: one transport, one audit trail; check results are immutable artifacts with provenance.
- Good: no new wire message types.
- Bad: `gate_b` is an attempt without a pipeline node; run views must label it.
- Bad: overriding a FAIL (an acknowledged `Assumption`) is not possible yet (backlog).

## Validation

- A pipeline that selects on the test set never starts its first step; the run shows the FAIL and its citations.
- Gate B attempts appear in run history with leases and audit events like any step.

## Note: provenance of the gate's inputs

The two input artifacts (pipeline, operators) are written by the scheduler, not by a worker. They record the gate attempt as `producer_attempt_id` because the contract has no "control plane" producer. Read it as "created for this attempt". If provenance views need the distinction, add a producer kind to the Artifact contract (v2).
