# ADR-0070: Gate B reads the ExecutionPlan Rust compiled
Status: Accepted
Date: 2026-10-28
Arch doc sections: §8, §9, §10

## Context
- Gate B's leakage check (`supervised.split_leakage`) rebuilds the graph in Python from the `PipelineVersion` and the operator manifests (integration map gap 6).
- So port rules live twice. Rust names a code step's ports from its params (ADR-0031); Python reads the manifest's ports instead.
- The gate gets each operator once, by id. Two code steps with the same operator but different ports look the same to Python.
- Python also re-derives which rows an output holds: a `fits_on_train` step's train outputs hold only its train input. That is a graph fact, which Rust owns (rule 2).
- Clustering steps (kmeans, gmm, dbscan) fit on every row they read. One fitted before the split feeds test rows into a model's features, and the check does not see it.

## Decision
- **A new contract, `ExecutionPlan`** (`sprisk.execution_plan/v1`, arch doc §9). It holds the compiled steps in run order. Each step has its node id, its operator, its inputs (port, from step and port), and its outputs (name, kind, `rows_from`).
- **`rows_from`** lists the input ports whose rows an output holds. Rust sets it: every input, except a `fits_on_train` step's train outputs, which hold only `train`.
- **The scheduler sends the plan to Gate B** as a fourth input, `plan`. The `PipelineVersion` stays, for ids and decisions.
- **Python builds its graph from the plan only.** It no longer reads ports or `fits_on_train` from manifests. It still reads operator facts it judges by: role, capability class, `model`, `attach`.
- **A step that fits a model on all it reads is checked like a fitting transform.** That is an operator with `model`, not an estimator, not `fits_on_train`. If its output reaches a model, it must read only a split's train rows. Otherwise the check fails and names both steps.
- The plan carries only what Gate B needs today. Digests and resources join it when a remote backend needs them.

## Alternatives considered
- **Keep the Python graph and send per-node operators.** Rejected: port rules would still live twice.
- **Move the leakage check into Rust.** Rejected: methodology checks are Python (rule 2).
- **Mark clustering steps by id.** Rejected: steps are found by manifest facts, never names (ADR-0064).

## Consequences (good and bad)
- Good: a port rule changes in one place, the compiler.
- Good: code steps' named ports reach the check.
- Good: a clustering fit on all rows upstream of a model is caught.
- Bad: one more wire entity, and the gate's inputs change shape.
- Bad: a clustering step fitted on all rows only to look at the data, with no model after it, is still allowed. That is correct, but the check does not say so.

## Validation
- Rust: the plan of a flow with an impute step marks impute's train outputs `rows_from: [train]`; a code step's plan lists its named ports.
- Python: kmeans on loaded rows feeding a model fails; kmeans on the split's train rows passes; kmeans with no model after it passes.
- Python: the existing leakage cases pass from the plan alone.
- API: a run whose clustering step reads unsplit rows into a model stops at Gate B.

## Arch doc edits
- §9: `ExecutionPlan` exists as a contract; Gate B is its first reader.
