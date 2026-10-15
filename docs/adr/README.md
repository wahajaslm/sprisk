# Architecture Decision Records

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-rust-monolith-python-workers.md) | Rust modular monolith control plane with separate Python AI and compute workers | Proposed |
| [0002](0002-typed-pipeline-spec.md) | Typed, versioned PipelineSpec and registered operator contracts; no prompt-to-raw-code execution by default | Proposed |
| [0003](0003-three-linked-domains.md) | Three linked domains: execution DAG, evidence graph, decision graph | Proposed |
| [0004](0004-sqlite-local-postgres-hosted.md) | SQLite and filesystem locally; PostgreSQL and S3-compatible storage hosted, with shared contracts | Proposed |
| [0005](0005-append-only-history.md) | Append-only run and audit history plus transactional operational state; not full event sourcing | Proposed |
| [0006](0006-science-in-python-policy-in-rust.md) | Scientific checks in Python; structural and policy enforcement in Rust; no claim of universal correctness | Proposed |
| [0007](0007-bounded-ai-autonomy.md) | AI autonomous only within bounded budgets; external AI transfer off by default | Proposed |
| [0008](0008-one-experiment-protocol.md) | One experiment protocol and artifact registry for manual, programmatic and AI workflows | Proposed |
| [0009](0009-cloud-via-adapters.md) | Cloud via adapters and worker isolation, not a microservice rewrite | Proposed |
| [0010](0010-dockable-workbench.md) | Dockable workbench with versioned view registry and layout, separate from pipelines; Dockview preferred, FlexLayout compared | Proposed |
| [0011](0011-pluggable-views.md) | Visualizations and code editors consume artifact/query APIs; UI never executes privileged code or copies full datasets | Proposed |

## Open questions (arch doc §17)

- License: Apache-2.0 vs AGPLv3 / dual licensing.
- Desktop packaging: Tauri + embedded Python.
- Hosted worker transport.
- Evidence ontology depth.
- OpenLineage / MLflow coverage.
- Multi-tenant enforcement and plugin marketplace policy.
- Name and trademark check.

Each one becomes an ADR when decided. Write new ADRs with `/adr`.
